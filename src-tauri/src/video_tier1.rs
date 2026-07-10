// Tier 1 video backend additions.
//
// This file is `include!`d into the crate root immediately after
// video_editor.rs. Keep imports local and names prefixed with `video_tier1_`.

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
struct VideoTier1ChromaKey {
    color: String,
    similarity: f64,
    blend: f64,
}

impl Default for VideoTier1ChromaKey {
    fn default() -> Self {
        Self {
            color: "#00ff00".to_string(),
            similarity: 0.2,
            blend: 0.1,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
struct VideoTier1Fx {
    exposure: f64,
    contrast: f64,
    saturation: f64,
    temperature: f64,
    curves: String,
    lut: String,
    chroma_key: Option<VideoTier1ChromaKey>,
    blur: f64,
    vignette: f64,
    grain: f64,
    blend: String,
}

impl Default for VideoTier1Fx {
    fn default() -> Self {
        Self {
            exposure: 0.0,
            contrast: 1.0,
            saturation: 1.0,
            temperature: 0.0,
            curves: "none".to_string(),
            lut: String::new(),
            chroma_key: None,
            blur: 0.0,
            vignette: 0.0,
            grain: 0.0,
            blend: "normal".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
struct VideoTier1Crop {
    l: f64,
    t: f64,
    r: f64,
    b: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
struct VideoTier1Word {
    text: String,
    start_ms: u64,
    end_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
struct VideoTier1AnimOpts {
    highlight_color: String,
}

impl Default for VideoTier1AnimOpts {
    fn default() -> Self {
        Self {
            highlight_color: "#fbbf24".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
struct VideoExportTransition {
    id: String,
    after_clip_id: String,
    kind: String,
    duration_ms: u64,
}

const VIDEO_TIER1_TRANSITION_KINDS: &[&str] = &[
    "crossfade",
    "dip-black",
    "dip-white",
    "wipe-left",
    "wipe-right",
    "wipe-up",
    "wipe-down",
    "slide-left",
    "slide-right",
];

fn video_tier1_validate_transition(kind: &str, duration_ms: u64) -> Result<(), String> {
    if !VIDEO_TIER1_TRANSITION_KINDS.contains(&kind) {
        return Err(format!("Unknown video transition kind: {kind}"));
    }
    if !(100..=3000).contains(&duration_ms) {
        return Err("Video transition durationMs must be between 100 and 3000.".to_string());
    }
    Ok(())
}

fn video_tier1_parse_transition_token(
    value: &str,
    line_number: usize,
) -> Result<(String, String, u64), String> {
    let fields = value.split(':').collect::<Vec<_>>();
    if fields.len() != 3 || fields[0].is_empty() {
        return Err(video_pipe_line_error(
            line_number,
            "transition must be <afterClipId>:<kind>:<durationMs>",
        ));
    }
    let duration_ms = video_pipe_parse_u64(fields[2], "transition", line_number)?;
    video_tier1_validate_transition(fields[1], duration_ms)
        .map_err(|error| video_pipe_line_error(line_number, &error))?;
    Ok((fields[0].to_string(), fields[1].to_string(), duration_ms))
}

fn video_tier1_normalize_fx(mut fx: VideoTier1Fx) -> Result<VideoTier1Fx, String> {
    for (label, value) in [
        ("exposure", fx.exposure),
        ("contrast", fx.contrast),
        ("saturation", fx.saturation),
        ("temperature", fx.temperature),
        ("blur", fx.blur),
        ("vignette", fx.vignette),
        ("grain", fx.grain),
    ] {
        if !value.is_finite() {
            return Err(format!("Video fx {label} must be finite."));
        }
    }
    fx.exposure = fx.exposure.clamp(-2.0, 2.0);
    fx.contrast = fx.contrast.clamp(0.5, 2.0);
    fx.saturation = fx.saturation.clamp(0.0, 3.0);
    fx.temperature = fx.temperature.clamp(-100.0, 100.0);
    fx.blur = fx.blur.clamp(0.0, 50.0);
    fx.vignette = fx.vignette.clamp(0.0, 1.0);
    fx.grain = fx.grain.clamp(0.0, 1.0);
    if !matches!(
        fx.curves.as_str(),
        "none" | "vintage" | "darker" | "lighter" | "increase_contrast" | "strong_contrast"
    ) {
        return Err(format!("Unknown video curves preset: {}", fx.curves));
    }
    if !matches!(
        fx.blend.as_str(),
        "normal" | "multiply" | "screen" | "overlay" | "lighten" | "darken" | "addition"
    ) {
        return Err(format!("Unknown video blend mode: {}", fx.blend));
    }
    if let Some(chroma) = fx.chroma_key.as_mut() {
        if !chroma.similarity.is_finite() || !chroma.blend.is_finite() {
            return Err("Video chromaKey values must be finite.".to_string());
        }
        chroma.similarity = chroma.similarity.clamp(0.0, 1.0);
        chroma.blend = chroma.blend.clamp(0.0, 1.0);
        if video_tier1_hex_rgb(&chroma.color).is_none() {
            return Err("Video chromaKey color must be #RRGGBB.".to_string());
        }
    }
    Ok(fx)
}

fn video_tier1_fx_from_value(value: Option<&serde_json::Value>) -> Result<VideoTier1Fx, String> {
    let Some(value) = value.filter(|value| !value.is_null()) else {
        return Ok(VideoTier1Fx::default());
    };
    let fx = serde_json::from_value::<VideoTier1Fx>(value.clone())
        .map_err(|error| format!("Invalid video fx object: {error}"))?;
    video_tier1_normalize_fx(fx)
}

fn video_tier1_parse_fx_token(value: &str, line_number: usize) -> Result<VideoTier1Fx, String> {
    let parsed = serde_json::from_str::<serde_json::Value>(value).map_err(|error| {
        video_pipe_line_error(line_number, &format!("invalid fx JSON: {error}"))
    })?;
    video_tier1_fx_from_value(Some(&parsed))
        .map_err(|error| video_pipe_line_error(line_number, &error))
}

fn video_tier1_crop_from_value(
    value: Option<&serde_json::Value>,
) -> Result<VideoTier1Crop, String> {
    let Some(value) = value.filter(|value| !value.is_null()) else {
        return Ok(VideoTier1Crop::default());
    };
    let mut crop = serde_json::from_value::<VideoTier1Crop>(value.clone())
        .map_err(|error| format!("Invalid video crop object: {error}"))?;
    for value in [&mut crop.l, &mut crop.t, &mut crop.r, &mut crop.b] {
        if !value.is_finite() {
            return Err("Video crop fractions must be finite.".to_string());
        }
        *value = value.clamp(0.0, 0.45);
    }
    Ok(crop)
}

fn video_tier1_parse_crop_token(value: &str, line_number: usize) -> Result<VideoTier1Crop, String> {
    let fields = value.split(':').collect::<Vec<_>>();
    if fields.len() != 4 {
        return Err(video_pipe_line_error(
            line_number,
            "crop must be <l>:<t>:<r>:<b>",
        ));
    }
    video_tier1_crop_from_value(Some(&serde_json::json!({
        "l": video_pipe_parse_f64(fields[0], "crop", line_number)?,
        "t": video_pipe_parse_f64(fields[1], "crop", line_number)?,
        "r": video_pipe_parse_f64(fields[2], "crop", line_number)?,
        "b": video_pipe_parse_f64(fields[3], "crop", line_number)?,
    })))
    .map_err(|error| video_pipe_line_error(line_number, &error))
}

fn video_tier1_parse_words_token(
    value: &str,
    line_number: usize,
) -> Result<Vec<VideoTier1Word>, String> {
    let words = serde_json::from_str::<Vec<VideoTier1Word>>(value).map_err(|error| {
        video_pipe_line_error(line_number, &format!("invalid words JSON: {error}"))
    })?;
    Ok(words)
}

fn video_tier1_parse_anim(value: &str, line_number: usize) -> Result<String, String> {
    if matches!(
        value,
        "none" | "typewriter" | "word-reveal" | "word-highlight" | "pop" | "fade"
    ) {
        Ok(value.to_string())
    } else {
        Err(video_pipe_line_error(
            line_number,
            "anim must be none, typewriter, word-reveal, word-highlight, pop, or fade",
        ))
    }
}

fn video_tier1_parse_anim_opts_token(
    value: &str,
    line_number: usize,
) -> Result<VideoTier1AnimOpts, String> {
    serde_json::from_str::<VideoTier1AnimOpts>(value).map_err(|error| {
        video_pipe_line_error(line_number, &format!("invalid animOpts JSON: {error}"))
    })
}

fn video_tier1_push_json_token(
    line: &mut String,
    key: &str,
    value: &serde_json::Value,
) -> Result<(), String> {
    let compact = serde_json::to_string(value)
        .map_err(|error| format!("Unable to serialize video {key}: {error}"))?;
    line.push(' ');
    line.push_str(key);
    line.push('=');
    line.push_str(&video_pipe_token_value(&compact));
    Ok(())
}

fn video_tier1_push_fx_token(
    line: &mut String,
    value: Option<&serde_json::Value>,
) -> Result<(), String> {
    let fx = video_tier1_fx_from_value(value)?;
    let default = VideoTier1Fx::default();
    let mut compact = serde_json::Map::new();
    macro_rules! insert_changed {
        ($field:ident, $name:literal) => {
            if fx.$field != default.$field {
                compact.insert($name.to_string(), serde_json::json!(fx.$field));
            }
        };
    }
    insert_changed!(exposure, "exposure");
    insert_changed!(contrast, "contrast");
    insert_changed!(saturation, "saturation");
    insert_changed!(temperature, "temperature");
    insert_changed!(curves, "curves");
    insert_changed!(lut, "lut");
    insert_changed!(chroma_key, "chromaKey");
    insert_changed!(blur, "blur");
    insert_changed!(vignette, "vignette");
    insert_changed!(grain, "grain");
    insert_changed!(blend, "blend");
    if compact.is_empty() {
        return Ok(());
    }
    video_tier1_push_json_token(line, "fx", &serde_json::Value::Object(compact))
}

fn video_tier1_push_crop_token(
    line: &mut String,
    value: Option<&serde_json::Value>,
) -> Result<(), String> {
    let crop = video_tier1_crop_from_value(value)?;
    if [crop.l, crop.t, crop.r, crop.b]
        .iter()
        .all(|value| video_pipe_f64_is_default(*value, 0.0))
    {
        return Ok(());
    }
    line.push_str(" crop=");
    line.push_str(&[
        video_pipe_format_f64(crop.l),
        video_pipe_format_f64(crop.t),
        video_pipe_format_f64(crop.r),
        video_pipe_format_f64(crop.b),
    ]
    .join(":"));
    Ok(())
}

fn video_tier1_push_words_token(
    line: &mut String,
    value: Option<&serde_json::Value>,
) -> Result<(), String> {
    let words = value
        .filter(|value| !value.is_null())
        .map(|value| serde_json::from_value::<Vec<VideoTier1Word>>(value.clone()))
        .transpose()
        .map_err(|error| format!("Invalid caption words: {error}"))?
        .unwrap_or_default();
    if words.is_empty() {
        return Ok(());
    }
    video_tier1_push_json_token(line, "words", &serde_json::json!(words))
}

fn video_tier1_push_anim_opts_token(
    line: &mut String,
    value: Option<&serde_json::Value>,
) -> Result<(), String> {
    let opts = value
        .filter(|value| !value.is_null())
        .map(|value| serde_json::from_value::<VideoTier1AnimOpts>(value.clone()))
        .transpose()
        .map_err(|error| format!("Invalid caption animOpts: {error}"))?
        .unwrap_or_default();
    if opts == VideoTier1AnimOpts::default() {
        return Ok(());
    }
    video_tier1_push_json_token(line, "animOpts", &serde_json::json!(opts))
}

fn video_tier1_hex_rgb(value: &str) -> Option<String> {
    let value = value.trim();
    if value.len() == 7
        && value.starts_with('#')
        && value[1..].chars().all(|ch| ch.is_ascii_hexdigit())
    {
        Some(value[1..].to_ascii_uppercase())
    } else {
        None
    }
}

fn video_tier1_validate_lut(
    root: &std::path::Path,
    media_root: &std::path::Path,
    raw_path: &str,
) -> Result<std::path::PathBuf, String> {
    let normalized = video_normalize_relative_path(raw_path)?;
    let required_prefix = std::path::Path::new(VIDEO_MEDIA_DIR).join("luts");
    if !normalized.starts_with(&required_prefix)
        || normalized
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| !value.eq_ignore_ascii_case("cube"))
            .unwrap_or(true)
    {
        return Err("path must be a .cube file under media/luts/.".to_string());
    }
    let abs = root.join(normalized);
    video_verify_canonical_contained(
        &media_root.join("luts"),
        &abs,
        "LUT path must stay under media/luts/.",
    )?;
    if !abs.is_file() {
        return Err(format!("file does not exist: {}", abs.display()));
    }
    Ok(abs)
}

fn video_tier1_bezier_points(easing: &str) -> Option<(f64, f64, f64, f64)> {
    match easing {
        "ease-in" => Some((0.42, 0.0, 1.0, 1.0)),
        "ease-out" => Some((0.0, 0.0, 0.58, 1.0)),
        "ease-in-out" => Some((0.42, 0.0, 0.58, 1.0)),
        _ => None,
    }
}

fn video_tier1_bezier_component(u: f64, p1: f64, p2: f64) -> f64 {
    let one_minus = 1.0 - u;
    3.0 * one_minus * one_minus * u * p1
        + 3.0 * one_minus * u * u * p2
        + u * u * u
}

fn video_tier1_ease_ratio(easing: &str, t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    if t == 0.0 || t == 1.0 {
        return t;
    }
    let Some((x1, y1, x2, y2)) = video_tier1_bezier_points(easing) else {
        return t;
    };
    let mut low = 0.0;
    let mut high = 1.0;
    for _ in 0..20 {
        let u = (low + high) * 0.5;
        if video_tier1_bezier_component(u, x1, x2) < t {
            low = u;
        } else {
            high = u;
        }
    }
    video_tier1_bezier_component((low + high) * 0.5, y1, y2)
}

fn video_tier1_bezier_ffmpeg_expression(easing: &str, ratio: &str) -> String {
    let Some((x1, y1, x2, y2)) = video_tier1_bezier_points(easing) else {
        return ratio.to_string();
    };
    let component = |u: &str, p1: f64, p2: f64| {
        format!(
            "(3*(1-({u}))*(1-({u}))*({u})*{}+3*(1-({u}))*({u})*({u})*{}+({u})*({u})*({u}))",
            video_ffmpeg_number(p1),
            video_ffmpeg_number(p2)
        )
    };
    let mut steps = vec!["st(0,0)".to_string(), "st(1,1)".to_string()];
    for _ in 0..20 {
        steps.push("st(2,(ld(0)+ld(1))/2)".to_string());
        steps.push(format!("st(3,{})", component("ld(2)", x1, x2)));
        steps.push(format!(
            "st(0,if(lt(ld(3),({ratio})),ld(2),ld(0)))"
        ));
        steps.push(format!(
            "st(1,if(gte(ld(3),({ratio})),ld(2),ld(1)))"
        ));
    }
    steps.push(component("((ld(0)+ld(1))/2)", y1, y2));
    format!(
        "if(lte(({ratio}),0),0,if(gte(({ratio}),1),1,{}))",
        steps.join("\\;")
    )
}

static VIDEO_TIER1_COLORTEMPERATURE_CACHE: std::sync::OnceLock<
    std::sync::Mutex<std::collections::HashMap<String, bool>>,
> = std::sync::OnceLock::new();

fn video_tier1_ffmpeg_supports_colortemperature(ffmpeg_path: &str) -> bool {
    let key = video_ffmpeg_drawtext_cache_key(ffmpeg_path);
    let cache = VIDEO_TIER1_COLORTEMPERATURE_CACHE
        .get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()));
    if let Ok(guard) = cache.lock() {
        if let Some(value) = guard.get(&key) {
            return *value;
        }
    }
    let supported = run_command_capture(
        ffmpeg_path,
        &["-hide_banner", "-filters"],
        None,
        std::time::Duration::from_secs(5),
        None,
    )
    .ok()
    .map(|capture| {
        command_output_text(&capture.stdout, &capture.stderr).contains(" colortemperature ")
    })
    .unwrap_or(false);
    if let Ok(mut guard) = cache.lock() {
        guard.insert(key, supported);
    }
    supported
}

fn video_tier1_escape_filter_path(path: &std::path::Path) -> String {
    path.to_string_lossy()
        .replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace(':', "\\:")
        .replace(',', "\\,")
        .replace(';', "\\;")
}

fn video_tier1_push_fx_filters(filters: &mut Vec<String>, clip: &VideoExportMediaClip, upper: bool) {
    let fx = &clip.fx;
    if upper {
        if let Some(chroma) = fx.chroma_key.as_ref() {
            if let Some(rgb) = video_tier1_hex_rgb(&chroma.color) {
                filters.push(format!(
                    "chromakey=0x{}:{}:{}",
                    rgb,
                    video_ffmpeg_number(chroma.similarity),
                    video_ffmpeg_number(chroma.blend)
                ));
            }
        }
    }
    if fx.exposure.abs() > 0.000001
        || (fx.contrast - 1.0).abs() > 0.000001
        || (fx.saturation - 1.0).abs() > 0.000001
    {
        filters.push(format!(
            "eq=brightness={}:contrast={}:saturation={}",
            video_ffmpeg_number(fx.exposure * 0.15),
            video_ffmpeg_number(fx.contrast),
            video_ffmpeg_number(fx.saturation)
        ));
    }
    if fx.temperature.abs() > 0.000001 {
        if clip.supports_colortemperature {
            filters.push(format!(
                "colortemperature=temperature={}",
                video_ffmpeg_number(6500.0 + fx.temperature * 35.0)
            ));
        } else {
            let shift = fx.temperature / 500.0;
            filters.push(format!(
                "colorbalance=rs={}:bs={}",
                video_ffmpeg_number(shift),
                video_ffmpeg_number(-shift)
            ));
        }
    }
    if fx.curves != "none" {
        filters.push(format!("curves=preset={}", fx.curves));
    }
    if let Some(lut_abs) = clip.lut_abs.as_ref() {
        filters.push(format!(
            "lut3d=file='{}'",
            video_tier1_escape_filter_path(lut_abs)
        ));
    }
    if fx.blur > 0.000001 {
        filters.push(format!("gblur=sigma={}", video_ffmpeg_number(fx.blur)));
    }
    if fx.vignette > 0.000001 {
        let angle = std::f64::consts::PI / 5.0
            + fx.vignette * (std::f64::consts::PI / 4.0 - std::f64::consts::PI / 5.0);
        filters.push(format!("vignette=angle={}", video_ffmpeg_number(angle)));
    }
    if fx.grain > 0.000001 {
        filters.push(format!(
            "noise=alls={}:allf=t",
            (fx.grain * 20.0).round() as u32
        ));
    }
}

fn video_tier1_crop_filter(crop: &VideoTier1Crop) -> Option<String> {
    if [crop.l, crop.t, crop.r, crop.b]
        .iter()
        .all(|value| value.abs() < 0.000001)
    {
        return None;
    }
    Some(format!(
        "crop=w=iw*(1-{}-{}):h=ih*(1-{}-{}):x=iw*{}:y=ih*{}",
        video_ffmpeg_number(crop.l),
        video_ffmpeg_number(crop.r),
        video_ffmpeg_number(crop.t),
        video_ffmpeg_number(crop.b),
        video_ffmpeg_number(crop.l),
        video_ffmpeg_number(crop.t)
    ))
}

fn video_tier1_visual_source_chain(
    clip: &VideoExportMediaClip,
    upper: bool,
    width: u32,
    height: u32,
    fps: f64,
    head_ms: u64,
    tail_ms: u64,
) -> String {
    let extended_duration_ms = clip
        .duration_ms
        .saturating_add(head_ms)
        .saturating_add(tail_ms);
    let target_width = ((width as f64) * clip.scale).round().max(1.0);
    let target_height = ((height as f64) * clip.scale).round().max(1.0);
    let mut filters = if clip.kind == "image" {
        vec![format!("[{}:v]setpts=PTS-STARTPTS", clip.input_index)]
    } else {
        let requested_source_head_ms = (head_ms as f64 * clip.speed).round() as u64;
        let source_head_ms = requested_source_head_ms.min(clip.source_in_ms);
        let available_head_ms = ((source_head_ms as f64) / clip.speed).round() as u64;
        let missing_head_ms = head_ms.saturating_sub(available_head_ms);
        let source_start_ms = clip.source_in_ms.saturating_sub(source_head_ms);
        let source_duration = ((clip
            .duration_ms
            .saturating_add(available_head_ms)
            .saturating_add(tail_ms)) as f64
            / 1000.0)
            * clip.speed;
        vec![
            format!(
                "[{}:v]trim=start={}:duration={}",
                clip.input_index,
                video_ffmpeg_seconds(source_start_ms),
                video_ffmpeg_number(source_duration)
            ),
            format!("setpts=(PTS-STARTPTS)/{}", video_ffmpeg_number(clip.speed)),
            format!("fps={}", video_ffmpeg_number(fps)),
            format!(
                "tpad=start_mode=clone:start_duration={}:stop_mode=clone:stop_duration={}",
                video_ffmpeg_seconds(missing_head_ms),
                video_ffmpeg_seconds(tail_ms)
            ),
            format!(
                "trim=duration={}",
                video_ffmpeg_seconds(extended_duration_ms)
            ),
        ]
    };
    // xfade requires both inputs to have an identical frame rate. Normalize every
    // visual source here so ordinary compositing and transition paths stay identical.
    if clip.kind == "image" {
        filters.push(format!("fps={}", video_ffmpeg_number(fps)));
        filters.push(format!(
            "trim=duration={}",
            video_ffmpeg_seconds(extended_duration_ms)
        ));
    }
    video_tier1_push_fx_filters(&mut filters, clip, upper);
    if let Some(crop) = video_tier1_crop_filter(&clip.crop) {
        filters.push(crop);
    }
    if clip.scale_keyframes.is_empty() {
        filters.push(format!(
            "scale=w={}:h={}:force_original_aspect_ratio=decrease",
            target_width, target_height
        ));
    } else {
        let scale = video_property_keyframe_expression(
            clip.scale,
            &clip.scale_keyframes,
            clip.filter_keyframe_offset_ms,
        );
        filters.push(format!(
            "scale=w='{}*({})':h='{}*({})':force_original_aspect_ratio=decrease:eval=frame",
            video_ffmpeg_number(width as f64),
            scale,
            video_ffmpeg_number(height as f64),
            scale
        ));
    }
    filters.push("format=yuva420p".to_string());
    if !clip.opacity_keyframes.is_empty() {
        filters.push(format!(
            "colorchannelmixer=aa='{}'",
            video_property_keyframe_expression(
                clip.opacity,
                &clip.opacity_keyframes,
                clip.filter_keyframe_offset_ms,
            )
        ));
    } else if clip.opacity < 0.999 {
        filters.push(format!(
            "colorchannelmixer=aa={}",
            video_ffmpeg_number(clip.opacity)
        ));
    }
    format!("{}[src{}]", filters.join(","), clip.input_index)
}

fn video_tier1_clip_xy(clip: &VideoExportMediaClip, timeline: bool) -> (String, String) {
    let offset = if timeline {
        clip.overlay_keyframe_offset_ms
    } else {
        clip.filter_keyframe_offset_ms
    };
    let x = if clip.x_keyframes.is_empty() {
        video_ffmpeg_number(clip.x)
    } else {
        video_property_keyframe_expression(clip.x, &clip.x_keyframes, offset)
    };
    let y = if clip.y_keyframes.is_empty() {
        video_ffmpeg_number(clip.y)
    } else {
        video_property_keyframe_expression(clip.y, &clip.y_keyframes, offset)
    };
    (x, y)
}

fn video_tier1_full_frame_layer(
    parts: &mut Vec<String>,
    clip: &VideoExportMediaClip,
    width: u32,
    height: u32,
) -> String {
    let (x, y) = video_tier1_clip_xy(clip, false);
    let label = format!("full{}", clip.input_index);
    parts.push(format!(
        "[src{}]crop=w='min(iw\\,{})':h='min(ih\\,{})':x=(iw-ow)/2:y=(ih-oh)/2,pad=width={}:height={}:x='(ow-iw)/2+({})*ow':y='(oh-ih)/2+({})*oh':color=black@0:eval=frame,format=yuva420p,settb=AVTB,setpts=PTS-STARTPTS[{}]",
        clip.input_index, width, height, width, height, x, y, label
    ));
    label
}

fn video_tier1_xfade_name(kind: &str) -> &'static str {
    match kind {
        "dip-black" => "fadeblack",
        "dip-white" => "fadewhite",
        "wipe-left" => "wipeleft",
        "wipe-right" => "wiperight",
        "wipe-up" => "wipeup",
        "wipe-down" => "wipedown",
        "slide-left" => "slideleft",
        "slide-right" => "slideright",
        _ => "fade",
    }
}

fn video_tier1_xfade_offset_ms(stream_duration_ms: u64, duration_ms: u64) -> u64 {
    stream_duration_ms.saturating_sub(duration_ms)
}

fn video_tier1_transition_halves(duration_ms: u64) -> (u64, u64) {
    let before_ms = duration_ms / 2;
    (before_ms, duration_ms.saturating_sub(before_ms))
}

fn video_tier1_visual_transition_handles(
    visual: &[&VideoExportMediaClip],
    index: usize,
) -> (u64, u64) {
    let clip = visual[index];
    let head_ms = index
        .checked_sub(1)
        .and_then(|left_index| visual.get(left_index).copied())
        .filter(|left| {
            left.track_id == clip.track_id
                && left.timeline_start_ms.saturating_add(left.duration_ms)
                    == clip.timeline_start_ms
        })
        .and_then(|left| left.transition_after.as_ref())
        .map(|transition| video_tier1_transition_halves(transition.duration_ms).0)
        .unwrap_or(0);
    let tail_ms = visual
        .get(index + 1)
        .copied()
        .filter(|right| {
            right.track_id == clip.track_id
                && clip.timeline_start_ms.saturating_add(clip.duration_ms)
                    == right.timeline_start_ms
        })
        .and_then(|_| clip.transition_after.as_ref())
        .map(|transition| video_tier1_transition_halves(transition.duration_ms).1)
        .unwrap_or(0);
    (head_ms, tail_ms)
}

fn video_tier1_media_transition_handles(
    media_clips: &[VideoExportMediaClip],
    input_index: usize,
) -> (u64, u64) {
    let visual = media_clips
        .iter()
        .filter(|clip| matches!(clip.kind.as_str(), "video" | "image"))
        .collect::<Vec<_>>();
    visual
        .iter()
        .position(|clip| clip.input_index == input_index)
        .map(|index| video_tier1_visual_transition_handles(&visual, index))
        .unwrap_or((0, 0))
}

#[derive(Debug, Clone, Default)]
struct VideoTier1AudioTransitionPlan {
    head_ms: u64,
    tail_ms: u64,
    transition_after_ms: Option<u64>,
    fade_in_ms: u64,
    fade_out_ms: u64,
}

fn video_tier1_composite_blend_layer(
    parts: &mut Vec<String>,
    previous: &str,
    placed: &str,
    mode: &str,
    start_ms: u64,
    end_ms: u64,
    output: &str,
) {
    let base = format!("{output}_base");
    let backdrop = format!("{output}_backdrop");
    let blended = format!("{output}_blended");
    parts.push(format!(
        "[{previous}]split=2[{base}][{backdrop}]"
    ));
    // blend's first input is the top/source image. Preserve that input's alpha,
    // then composite the blended RGB result over an untouched backdrop copy so
    // padding, opacity, and chroma-key transparency remain meaningful.
    parts.push(format!(
        "[{placed}][{backdrop}]blend=all_mode={mode}:c3_expr=A:shortest=1[{blended}]"
    ));
    parts.push(format!(
        "[{base}][{blended}]overlay=x=0:y=0:eof_action=pass:repeatlast=0:enable='between(t,{},{})'[{output}]",
        video_ffmpeg_seconds(start_ms),
        video_ffmpeg_seconds(end_ms)
    ));
}

fn video_tier1_drawtext_options(
    clip: &VideoExportTextClip,
    text: &str,
    color: &str,
    enable_start_ms: u64,
    enable_end_ms: u64,
    alpha: Option<&str>,
    x_override: Option<&str>,
    include_box: bool,
) -> String {
    let fontfile = video_drawtext_fontfile(&clip.font_family, clip.bold)
        .map(|path| format!("fontfile={}:", video_escape_drawtext(path)))
        .unwrap_or_default();
    let x = x_override
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| format!("w*{}-text_w/2", video_ffmpeg_number(clip.x)));
    let mut draw = format!(
        "drawtext=expansion=none:{}text={}:fontsize={}:fontcolor={}:text_align={}:x={}:y=h*{}-text_h/2:enable='between(t,{},{})'",
        fontfile,
        video_escape_drawtext(text),
        video_ffmpeg_number(clip.font_size),
        video_escape_filter_color(color, "#ffffff"),
        clip.align,
        x,
        video_ffmpeg_number(clip.y),
        video_ffmpeg_seconds(enable_start_ms),
        video_ffmpeg_seconds(enable_end_ms),
    );
    if let Some(alpha) = alpha {
        draw.push_str(&format!(":alpha='{}'", alpha));
    }
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
    if include_box {
        if let Some(background) = clip
            .background
            .as_deref()
            .and_then(video_parse_background_for_box)
        {
            draw.push_str(&format!(":box=1:boxcolor={}:boxborderw=8", background));
        }
    }
    draw
}

fn video_tier1_add_drawtext(
    parts: &mut Vec<String>,
    previous: &mut String,
    draw_index: &mut usize,
    options: String,
) {
    let output = format!("txt{}", *draw_index);
    parts.push(format!("[{}]{}[{}]", previous, options, output));
    *previous = output;
    *draw_index += 1;
}

fn video_tier1_caption_word_window(
    clip: &VideoExportTextClip,
    word: &VideoTier1Word,
) -> (u64, u64) {
    let start = clip
        .timeline_start_ms
        .saturating_add(word.start_ms.saturating_sub(clip.word_time_offset_ms));
    let end = clip
        .timeline_start_ms
        .saturating_add(word.end_ms.saturating_sub(clip.word_time_offset_ms))
        .min(clip.timeline_start_ms.saturating_add(clip.duration_ms));
    (start, end.max(start))
}

fn video_tier1_add_caption_filters(
    parts: &mut Vec<String>,
    previous: &mut String,
    draw_index: &mut usize,
    clip: &VideoExportTextClip,
) {
    let full_text = if clip.uppercase {
        clip.text.to_uppercase()
    } else {
        clip.text.clone()
    };
    let clip_end = clip.timeline_start_ms.saturating_add(clip.duration_ms);
    let windowed = clip.words.len() <= 120 && !clip.words.is_empty();
    let anim = match clip.anim.as_str() {
        "typewriter" | "word-reveal" | "word-highlight" if !windowed => "none",
        other => other,
    };
    let fade_alpha = if matches!(anim, "fade" | "pop") {
        Some(format!(
            "max(0\\,min(1\\,(t-{})/0.25))",
            video_ffmpeg_number(clip.timeline_start_ms as f64 / 1000.0)
        ))
    } else {
        None
    };
    match anim {
        "typewriter" => {
            let mut prefix = Vec::<String>::new();
            for (index, word) in clip.words.iter().enumerate() {
                prefix.push(word.text.clone());
                let (start, _) = video_tier1_caption_word_window(clip, word);
                let end = clip
                    .words
                    .get(index + 1)
                    .map(|next| video_tier1_caption_word_window(clip, next).0)
                    .unwrap_or(clip_end);
                video_tier1_add_drawtext(
                    parts,
                    previous,
                    draw_index,
                    video_tier1_drawtext_options(
                        clip,
                        &prefix.join(" "),
                        &clip.color,
                        start,
                        end,
                        None,
                        None,
                        true,
                    ),
                );
            }
        }
        "word-reveal" => {
            let total_chars = clip
                .words
                .iter()
                .map(|word| word.text.chars().count())
                .sum::<usize>()
                + clip.words.len().saturating_sub(1);
            let mut prefix_chars = 0usize;
            for word in &clip.words {
                let (start, _) = video_tier1_caption_word_window(clip, word);
                let alpha = format!(
                    "max(0\\,min(1\\,(t-{})/0.15))",
                    video_ffmpeg_number(start as f64 / 1000.0)
                );
                let x = format!(
                    "w*{}-{}*{}*0.3+{}*{}*0.6",
                    video_ffmpeg_number(clip.x),
                    total_chars,
                    video_ffmpeg_number(clip.font_size),
                    prefix_chars,
                    video_ffmpeg_number(clip.font_size)
                );
                video_tier1_add_drawtext(
                    parts,
                    previous,
                    draw_index,
                    video_tier1_drawtext_options(
                        clip,
                        &word.text,
                        &clip.color,
                        start,
                        clip_end,
                        Some(&alpha),
                        Some(&x),
                        false,
                    ),
                );
                prefix_chars += word.text.chars().count() + 1;
            }
        }
        "word-highlight" => {
            video_tier1_add_drawtext(
                parts,
                previous,
                draw_index,
                video_tier1_drawtext_options(
                    clip,
                    &full_text,
                    &clip.color,
                    clip.timeline_start_ms,
                    clip_end,
                    None,
                    None,
                    true,
                ),
            );
            let total_chars = full_text.chars().count();
            let mut prefix_chars = 0usize;
            for word in &clip.words {
                let (start, end) = video_tier1_caption_word_window(clip, word);
                let x = format!(
                    "w*{}-{}*{}*0.3+{}*{}*0.6",
                    video_ffmpeg_number(clip.x),
                    total_chars,
                    video_ffmpeg_number(clip.font_size),
                    prefix_chars,
                    video_ffmpeg_number(clip.font_size)
                );
                video_tier1_add_drawtext(
                    parts,
                    previous,
                    draw_index,
                    video_tier1_drawtext_options(
                        clip,
                        &word.text,
                        &clip.anim_opts.highlight_color,
                        start,
                        end,
                        None,
                        Some(&x),
                        false,
                    ),
                );
                prefix_chars += word.text.chars().count() + 1;
            }
        }
        _ => video_tier1_add_drawtext(
            parts,
            previous,
            draw_index,
            video_tier1_drawtext_options(
                clip,
                &full_text,
                &clip.color,
                clip.timeline_start_ms,
                clip_end,
                fade_alpha.as_deref(),
                None,
                true,
            ),
        ),
    }
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
    let mut parts = vec![format!(
        "color=c={}:s={}x{}:r={}:d={}[base]",
        background,
        width,
        height,
        video_ffmpeg_number(fps),
        duration
    )];
    let first_video_track = media_clips
        .iter()
        .filter(|clip| matches!(clip.kind.as_str(), "video" | "image"))
        .map(|clip| clip.track_order)
        .min();
    let visual_source = media_clips
        .iter()
        .filter(|clip| matches!(clip.kind.as_str(), "video" | "image"))
        .collect::<Vec<_>>();
    let visual_handles = (0..visual_source.len())
        .map(|index| video_tier1_visual_transition_handles(&visual_source, index))
        .collect::<Vec<_>>();
    let visual = visual_source
        .iter()
        .enumerate()
        .map(|(index, clip)| {
            let mut clip = (*clip).clone();
            clip.filter_keyframe_offset_ms = clip
                .filter_keyframe_offset_ms
                .saturating_add(i64::try_from(visual_handles[index].0).unwrap_or(i64::MAX));
            clip
        })
        .collect::<Vec<_>>();
    for (index, clip) in visual.iter().enumerate() {
        parts.push(video_tier1_visual_source_chain(
            clip,
            first_video_track.is_some_and(|first| clip.track_order > first),
            width,
            height,
            fps,
            visual_handles[index].0,
            visual_handles[index].1,
        ));
    }
    let mut previous = "base".to_string();
    let mut overlay_index = 0usize;
    let mut index = 0usize;
    while index < visual.len() {
        let clip = &visual[index];
        if let Some(transition) = clip.transition_after.as_ref() {
            if let Some(_next) = visual.get(index + 1).filter(|next| {
                next.track_id == clip.track_id
                    && next.clip_id != clip.clip_id
                    && next.timeline_start_ms == clip.timeline_start_ms + clip.duration_ms
            }) {
                let mut current = video_tier1_full_frame_layer(&mut parts, clip, width, height);
                let group_start = clip
                    .timeline_start_ms
                    .saturating_sub(visual_handles[index].0);
                let mut stream_duration = clip
                    .duration_ms
                    .saturating_add(visual_handles[index].0)
                    .saturating_add(visual_handles[index].1);
                let mut left = clip;
                let mut next_index = index + 1;
                loop {
                    let Some(trans) = left.transition_after.as_ref() else {
                        break;
                    };
                    let Some(right) = visual.get(next_index).filter(|right| {
                        right.track_id == left.track_id
                            && right.timeline_start_ms
                                == left.timeline_start_ms + left.duration_ms
                    }) else {
                        break;
                    };
                    let right_label =
                        video_tier1_full_frame_layer(&mut parts, right, width, height);
                    let output = format!("xf{}", overlay_index);
                    let offset = video_tier1_xfade_offset_ms(stream_duration, trans.duration_ms);
                    parts.push(format!(
                        "[{}][{}]xfade=transition={}:duration={}:offset={}[{}]",
                        current,
                        right_label,
                        video_tier1_xfade_name(&trans.kind),
                        video_ffmpeg_seconds(trans.duration_ms),
                        video_ffmpeg_seconds(offset),
                        output
                    ));
                    current = output;
                    stream_duration = offset
                        .saturating_add(right.duration_ms)
                        .saturating_add(visual_handles[next_index].0)
                        .saturating_add(visual_handles[next_index].1);
                    left = right;
                    next_index += 1;
                }
                let group_end = group_start.saturating_add(stream_duration);
                let placed = format!("xft{}", overlay_index);
                parts.push(format!(
                    "[{}]setpts=PTS+{}/TB[{}]",
                    current,
                    video_ffmpeg_seconds(group_start),
                    placed
                ));
                let output = format!("o{}", overlay_index);
                let blend = clip.fx.blend.as_str();
                if blend == "normal" {
                    parts.push(format!(
                        "[{}][{}]overlay=x=0:y=0:eof_action=pass:repeatlast=0:enable='between(t,{},{})'[{}]",
                        previous,
                        placed,
                        video_ffmpeg_seconds(group_start),
                        video_ffmpeg_seconds(group_end),
                        output
                    ));
                } else {
                    video_tier1_composite_blend_layer(
                        &mut parts,
                        &previous,
                        &placed,
                        blend,
                        group_start,
                        group_end,
                        &output,
                    );
                }
                previous = output;
                overlay_index += 1;
                index = next_index;
                continue;
            }
            let _ = transition;
        }

        let start = clip.timeline_start_ms;
        let end = start.saturating_add(clip.duration_ms);
        let output = format!("o{}", overlay_index);
        if clip.fx.blend == "normal" {
            let label = format!("v{}", overlay_index);
            parts.push(format!(
                "[src{}]setpts=PTS+{}/TB[{}]",
                clip.input_index,
                video_ffmpeg_seconds(start),
                label
            ));
            let (x, y) = video_tier1_clip_xy(clip, true);
            if clip.x_keyframes.is_empty() && clip.y_keyframes.is_empty() {
                parts.push(format!(
                    "[{}][{}]overlay=x='(W-w)/2+{}*W':y='(H-h)/2+{}*H':enable='between(t,{},{})'[{}]",
                    previous, label, x, y, video_ffmpeg_seconds(start), video_ffmpeg_seconds(end), output
                ));
            } else {
                parts.push(format!(
                    "[{}][{}]overlay=x='(W-w)/2+({})*W':y='(H-h)/2+({})*H':enable='between(t,{},{})'[{}]",
                    previous, label, x, y, video_ffmpeg_seconds(start), video_ffmpeg_seconds(end), output
                ));
            }
        } else {
            let full = video_tier1_full_frame_layer(&mut parts, clip, width, height);
            let placed = format!("blendv{}", overlay_index);
            parts.push(format!(
                "[{}]setpts=PTS+{}/TB[{}]",
                full,
                video_ffmpeg_seconds(start),
                placed
            ));
            video_tier1_composite_blend_layer(
                &mut parts,
                &previous,
                &placed,
                &clip.fx.blend,
                start,
                end,
                &output,
            );
        }
        previous = output;
        overlay_index += 1;
        index += 1;
    }

    let mut draw_index = 0usize;
    for clip in text_clips {
        video_tier1_add_caption_filters(&mut parts, &mut previous, &mut draw_index, clip);
    }
    let video_output = "vout".to_string();
    parts.push(format!("[{}]format=yuv420p[{}]", previous, video_output));

    let audio_output = "aout".to_string();
    if include_audio {
        let audio_clips = media_clips
            .iter()
            .filter(|clip| clip.has_audio && clip.kind != "image")
            .collect::<Vec<_>>();
        let mut audio_plans = audio_clips
            .iter()
            .map(|clip| (clip.input_index, VideoTier1AudioTransitionPlan::default()))
            .collect::<std::collections::BTreeMap<_, _>>();
        for (left_index, left_visual) in visual_source.iter().enumerate() {
            let Some(transition) = left_visual.transition_after.as_ref() else {
                continue;
            };
            let Some(right_visual) = visual_source.get(left_index + 1).copied().filter(|right| {
                right.track_id == left_visual.track_id
                    && left_visual
                        .timeline_start_ms
                        .saturating_add(left_visual.duration_ms)
                        == right.timeline_start_ms
            }) else {
                continue;
            };
            let direct_pair = left_visual
                .has_audio
                .then_some(left_visual.input_index)
                .zip(right_visual.has_audio.then_some(right_visual.input_index));
            let linked_pair = (!left_visual.link_id.is_empty()
                && !right_visual.link_id.is_empty())
                .then(|| {
                    audio_clips.iter().find_map(|left_audio| {
                        if left_audio.link_id != left_visual.link_id
                            || left_audio.timeline_start_ms != left_visual.timeline_start_ms
                        {
                            return None;
                        }
                        audio_clips.iter().find_map(|right_audio| {
                            (right_audio.link_id == right_visual.link_id
                                && right_audio.track_id == left_audio.track_id
                                && right_audio.timeline_start_ms == right_visual.timeline_start_ms
                                && left_audio
                                    .timeline_start_ms
                                    .saturating_add(left_audio.duration_ms)
                                    == right_audio.timeline_start_ms)
                                .then_some((left_audio.input_index, right_audio.input_index))
                        })
                    })
                })
                .flatten();
            if let Some((left_audio, right_audio)) = linked_pair.or(direct_pair) {
                let (before_ms, after_ms) =
                    video_tier1_transition_halves(transition.duration_ms);
                if let Some(plan) = audio_plans.get_mut(&left_audio) {
                    plan.tail_ms = plan.tail_ms.max(after_ms);
                    plan.transition_after_ms = Some(transition.duration_ms);
                }
                if let Some(plan) = audio_plans.get_mut(&right_audio) {
                    plan.head_ms = plan.head_ms.max(before_ms);
                }
            } else {
                for clip in &audio_clips {
                    if !left_visual.link_id.is_empty()
                        && clip.link_id == left_visual.link_id
                        && clip.timeline_start_ms == left_visual.timeline_start_ms
                    {
                        if let Some(plan) = audio_plans.get_mut(&clip.input_index) {
                            plan.fade_out_ms = transition.duration_ms.min(clip.duration_ms);
                        }
                    }
                    if !right_visual.link_id.is_empty()
                        && clip.link_id == right_visual.link_id
                        && clip.timeline_start_ms == right_visual.timeline_start_ms
                    {
                        if let Some(plan) = audio_plans.get_mut(&clip.input_index) {
                            plan.fade_in_ms = transition.duration_ms.min(clip.duration_ms);
                        }
                    }
                }
            }
        }
        for clip in &audio_clips {
            let plan = audio_plans
                .get(&clip.input_index)
                .cloned()
                .unwrap_or_default();
            let requested_source_head_ms = (plan.head_ms as f64 * clip.speed).round() as u64;
            let source_head_ms = requested_source_head_ms.min(clip.source_in_ms);
            let available_head_ms = ((source_head_ms as f64) / clip.speed).round() as u64;
            let missing_head_ms = plan.head_ms.saturating_sub(available_head_ms);
            let source_start_ms = clip.source_in_ms.saturating_sub(source_head_ms);
            let source_duration_ms = clip
                .duration_ms
                .saturating_add(available_head_ms)
                .saturating_add(plan.tail_ms);
            let extended_duration_ms = clip
                .duration_ms
                .saturating_add(plan.head_ms)
                .saturating_add(plan.tail_ms);
            let mut filters = vec![
                format!(
                    "[{}:a]atrim=start={}:duration={}",
                    clip.input_index,
                    video_ffmpeg_seconds(source_start_ms),
                    video_ffmpeg_number((source_duration_ms as f64 / 1000.0) * clip.speed)
                ),
                "asetpts=PTS-STARTPTS".to_string(),
            ];
            filters.extend(video_atempo_chain(clip.speed));
            if missing_head_ms > 0 {
                filters.push(format!(
                    "adelay={}|{}",
                    missing_head_ms, missing_head_ms
                ));
            }
            if plan.tail_ms > 0 {
                filters.push(format!(
                    "apad=pad_dur={}",
                    video_ffmpeg_seconds(plan.tail_ms)
                ));
            }
            filters.push(format!(
                "atrim=duration={}",
                video_ffmpeg_seconds(extended_duration_ms)
            ));
            if clip.gain_keyframes.is_empty() {
                filters.push(format!("volume={}", video_ffmpeg_number(clip.gain_level)));
            } else {
                let shifted_keyframes = clip
                    .gain_keyframes
                    .iter()
                    .map(|(at_ms, level)| (at_ms.saturating_add(plan.head_ms), *level))
                    .collect::<Vec<_>>();
                filters.push(format!(
                    "volume='{}':eval=frame",
                    video_gain_expression(clip.gain_level, &shifted_keyframes)
                ));
            }
            if plan.fade_in_ms > 0 {
                filters.push(format!(
                    "afade=t=in:st={}:d={}",
                    video_ffmpeg_seconds(plan.head_ms),
                    video_ffmpeg_seconds(plan.fade_in_ms)
                ));
            }
            if plan.fade_out_ms > 0 {
                filters.push(format!(
                    "afade=t=out:st={}:d={}",
                    video_ffmpeg_seconds(
                        plan.head_ms
                            .saturating_add(clip.duration_ms.saturating_sub(plan.fade_out_ms))
                    ),
                    video_ffmpeg_seconds(plan.fade_out_ms)
                ));
            }
            parts.push(format!("{}[asrc{}]", filters.join(","), clip.input_index));
        }
        let mut audio_labels = Vec::new();
        let mut audio_index = 0usize;
        while audio_index < audio_clips.len() {
            let clip = audio_clips[audio_index];
            let mut current = format!("asrc{}", clip.input_index);
            let mut next_index = audio_index + 1;
            let mut chained = false;
            let plan = audio_plans
                .get(&clip.input_index)
                .cloned()
                .unwrap_or_default();
            let group_start = clip.timeline_start_ms.saturating_sub(plan.head_ms);
            let mut left = clip;
            while let Some(duration_ms) = audio_plans
                .get(&left.input_index)
                .and_then(|plan| plan.transition_after_ms)
            {
                let Some(right) = audio_clips.get(next_index).copied().filter(|right| {
                    right.track_id == left.track_id
                        && right.timeline_start_ms == left.timeline_start_ms + left.duration_ms
                }) else {
                    break;
                };
                let output = format!("af{}", audio_labels.len());
                parts.push(format!(
                    "[{}][asrc{}]acrossfade=d={}:c1=tri:c2=tri[{}]",
                    current,
                    right.input_index,
                    video_ffmpeg_seconds(duration_ms),
                    output
                ));
                current = output;
                left = right;
                next_index += 1;
                chained = true;
            }
            let output = format!("a{}", audio_labels.len());
            parts.push(format!(
                "[{}]adelay={}|{},apad[{}]",
                current, group_start, group_start, output
            ));
            audio_labels.push(output);
            audio_index = if chained { next_index } else { audio_index + 1 };
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
                "{}amix=inputs={}:duration=longest:normalize=0,atrim=duration={}[{}]",
                inputs,
                audio_labels.len(),
                duration,
                audio_output
            ));
        }
    }
    (parts.join(";"), video_output, audio_output)
}

fn video_tier1_normalize_transition_on_track(
    track: &VideoMcpTrack,
    transition: &mut VideoExportTransition,
) -> bool {
    if track.kind != "video" {
        return false;
    }
    if !VIDEO_TIER1_TRANSITION_KINDS.contains(&transition.kind.as_str()) {
        transition.kind = "crossfade".to_string();
    }
    let mut clips = track.clips.iter().collect::<Vec<_>>();
    clips.sort_by_key(|clip| clip.timeline_start_ms);
    let Some(left_index) = clips
        .iter()
        .position(|clip| clip.id == transition.after_clip_id)
    else {
        return false;
    };
    let Some(right) = clips.get(left_index + 1) else {
        return false;
    };
    let left = clips[left_index];
    if left.asset_path.is_empty()
        || right.asset_path.is_empty()
        || video_mcp_clip_end(left) != right.timeline_start_ms
    {
        return false;
    }
    let cap = left.duration_ms.min(right.duration_ms) / 2;
    if cap < 100 {
        return false;
    }
    transition.duration_ms = transition.duration_ms.clamp(100, 3000).min(cap);
    true
}

fn video_tier1_normalize_mcp_transitions(project: &mut VideoMcpProject) {
    for track in &mut project.tracks {
        let mut transitions = std::mem::take(&mut track.transitions);
        transitions.retain_mut(|transition| {
            video_tier1_normalize_transition_on_track(track, transition)
        });
        let mut seen_after = std::collections::BTreeSet::new();
        transitions.retain(|transition| seen_after.insert(transition.after_clip_id.clone()));
        track.transitions = transitions;
    }
}

fn video_tier1_next_transition_id(project: &VideoMcpProject) -> String {
    let next = project
        .tracks
        .iter()
        .flat_map(|track| track.transitions.iter())
        .filter_map(|transition| transition.id.strip_prefix("tr"))
        .filter_map(|suffix| suffix.parse::<u64>().ok())
        .max()
        .unwrap_or(0)
        .saturating_add(1);
    format!("tr{next}")
}

fn video_tier1_mcp_add_transition(
    project: &mut VideoMcpProject,
    track_id: &str,
    after_clip_id: &str,
    kind: &str,
    duration_ms: u64,
    state: &mut VideoMcpEditState,
) -> Result<(), String> {
    video_tier1_validate_transition(kind, duration_ms)?;
    let track_index = project
        .tracks
        .iter()
        .position(|track| track.id == track_id)
        .ok_or_else(|| format!("track {track_id} not found"))?;
    if project.tracks[track_index].locked {
        return Err(format!("track {track_id} is locked"));
    }
    if project.tracks[track_index].kind != "video" {
        return Err("transitions require a video track".to_string());
    }
    let mut clip_order = project.tracks[track_index]
        .clips
        .iter()
        .enumerate()
        .collect::<Vec<_>>();
    clip_order.sort_by_key(|(_, clip)| clip.timeline_start_ms);
    let left_order = clip_order
        .iter()
        .position(|(_, clip)| clip.id == after_clip_id)
        .ok_or_else(|| format!("clip {after_clip_id} not found on track {track_id}"))?;
    let Some((_, right)) = clip_order.get(left_order + 1) else {
        return Err("transition requires a next clip".to_string());
    };
    let left = clip_order[left_order].1;
    let right_id = right.id.clone();
    if left.asset_path.is_empty()
        || right.asset_path.is_empty()
        || video_mcp_clip_end(left) != right.timeline_start_ms
    {
        return Err("transition clips must be exactly adjacent video clips".to_string());
    }
    let max_duration = left.duration_ms.min(right.duration_ms) / 2;
    if max_duration < 100 {
        return Err("adjacent clips are too short for a transition".to_string());
    }
    let duration_ms = duration_ms.clamp(100, 3000).min(max_duration);
    let id = project.tracks[track_index]
        .transitions
        .iter()
        .find(|transition| transition.after_clip_id == after_clip_id)
        .map(|transition| transition.id.clone())
        .unwrap_or_else(|| video_tier1_next_transition_id(project));
    project.tracks[track_index]
        .transitions
        .retain(|transition| transition.after_clip_id != after_clip_id);
    project.tracks[track_index]
        .transitions
        .push(VideoExportTransition {
            id: id.clone(),
            after_clip_id: after_clip_id.to_string(),
            kind: kind.to_string(),
            duration_ms,
        });
    state.changed_clip_ids.insert(after_clip_id.to_string());
    state.changed_clip_ids.insert(right_id);
    state
        .summaries
        .push(format!("added transition {id} after {after_clip_id}"));
    Ok(())
}

fn video_tier1_mcp_remove_transition(
    project: &mut VideoMcpProject,
    transition_id: &str,
    state: &mut VideoMcpEditState,
) -> Result<(), String> {
    for track in &mut project.tracks {
        if let Some(index) = track
            .transitions
            .iter()
            .position(|transition| transition.id == transition_id)
        {
            if track.locked {
                return Err(format!("track {} is locked", track.id));
            }
            let transition = track.transitions.remove(index);
            state.changed_clip_ids.insert(transition.after_clip_id);
            state
                .summaries
                .push(format!("removed transition {transition_id}"));
            return Ok(());
        }
    }
    Err(format!("transition {transition_id} not found"))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct VideoSilenceRange {
    start_ms: u64,
    end_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoDetectSilencesResponse {
    ranges: Vec<VideoSilenceRange>,
}

fn video_tier1_parse_silencedetect_output(
    output: &str,
    source_duration_ms: Option<u64>,
) -> Vec<VideoSilenceRange> {
    let mut ranges = Vec::new();
    let mut open_start = None::<u64>;
    for line in output.lines() {
        if let Some(value) = line.split("silence_start:").nth(1) {
            let seconds = value
                .split_whitespace()
                .next()
                .and_then(|value| value.parse::<f64>().ok());
            if let Some(seconds) = seconds.filter(|value| value.is_finite() && *value >= 0.0) {
                open_start = Some((seconds * 1000.0).round() as u64);
            }
        }
        if let Some(value) = line.split("silence_end:").nth(1) {
            let seconds = value
                .split_whitespace()
                .next()
                .and_then(|value| value.parse::<f64>().ok());
            if let (Some(start_ms), Some(seconds)) = (
                open_start.take(),
                seconds.filter(|value| value.is_finite() && *value >= 0.0),
            ) {
                let end_ms = (seconds * 1000.0).round() as u64;
                if end_ms > start_ms {
                    ranges.push(VideoSilenceRange { start_ms, end_ms });
                }
            }
        }
    }
    if let (Some(start_ms), Some(end_ms)) = (open_start, source_duration_ms) {
        if end_ms > start_ms {
            ranges.push(VideoSilenceRange { start_ms, end_ms });
        }
    }
    ranges
}

fn video_tier1_detect_silences_blocking(
    ffmpeg_path: &str,
    ffprobe_path: Option<&str>,
    asset_abs: &std::path::Path,
    noise_db: f64,
    min_ms: u64,
) -> Result<Vec<VideoSilenceRange>, String> {
    if !noise_db.is_finite() {
        return Err("noiseDb must be finite.".to_string());
    }
    let noise_db = noise_db.clamp(-100.0, 0.0);
    let min_ms = min_ms.max(1);
    let probe = ffprobe_path.and_then(|path| video_probe_media(path, asset_abs));
    if probe.as_ref().and_then(|probe| probe.has_audio) == Some(false) {
        return Ok(Vec::new());
    }
    let source_duration_ms = probe.and_then(|probe| probe.duration_ms);
    let mut command = std::process::Command::new(ffmpeg_path);
    apply_desktop_command_environment(&mut command);
    command.args([
        "-nostdin",
        "-hide_banner",
        "-v",
        "info",
        "-i",
        asset_abs.to_string_lossy().as_ref(),
        "-map",
        "0:a:0",
        "-af",
        &format!(
            "silencedetect=noise={}dB:d={}",
            video_ffmpeg_number(noise_db),
            video_ffmpeg_number(min_ms as f64 / 1000.0)
        ),
        "-f",
        "null",
        "-",
    ]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        command.creation_flags(0x08000000);
    }
    let output = command
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|error| format!("Unable to run ffmpeg silence detection: {error}"))?;
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() {
        let detail = stderr
            .lines()
            .rev()
            .take(12)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
        return Err(if detail.is_empty() {
            "ffmpeg silence detection failed.".to_string()
        } else {
            format!("ffmpeg silence detection failed: {detail}")
        });
    }
    Ok(video_tier1_parse_silencedetect_output(
        &stderr,
        source_duration_ms,
    ))
}

#[tauri::command]
async fn video_detect_silences(
    app: tauri::AppHandle,
    repo_path: String,
    asset_path: String,
    noise_db: Option<f64>,
    min_ms: Option<u64>,
) -> Result<VideoDetectSilencesResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (root, media_root) = video_workspace_media_root(&repo_path)?;
        video_ensure_media_dirs(&media_root)?;
        let (asset_abs, _rel, kind, _metadata) =
            video_resolve_existing_media_file(&root, &media_root, &asset_path)?;
        if !matches!(kind, "audio" | "video") {
            return Err("Silence detection requires an audio or video asset.".to_string());
        }
        let tools = video_tools_status_for(&app);
        let ffmpeg_path = tools
            .ffmpeg
            .path
            .ok_or_else(|| "ffmpeg is required to detect silences.".to_string())?;
        let ranges = video_tier1_detect_silences_blocking(
            &ffmpeg_path,
            tools.ffprobe.path.as_deref(),
            &asset_abs,
            noise_db.unwrap_or(-35.0),
            min_ms.unwrap_or(400),
        )?;
        Ok(VideoDetectSilencesResponse { ranges })
    })
    .await
    .map_err(|error| format!("Video silence detection worker failed: {error}"))?
}

fn video_tier1_ffmpeg_path_for_mcp(ffprobe_path: Option<&str>) -> String {
    if let Some(ffprobe_path) = ffprobe_path {
        let sibling = std::path::Path::new(ffprobe_path)
            .parent()
            .map(|parent| parent.join(video_executable_name("ffmpeg")));
        if let Some(sibling) = sibling.filter(|path| path.is_file()) {
            return sibling.to_string_lossy().to_string();
        }
    }
    video_executable_name("ffmpeg")
}

fn video_tier1_mcp_remove_silences(
    project: &mut VideoMcpProject,
    root: &std::path::Path,
    media_root: &std::path::Path,
    ffprobe_path: Option<&str>,
    asset_path: Option<&str>,
    noise_db: f64,
    min_ms: u64,
    state: &mut VideoMcpEditState,
) -> Result<(), String> {
    let asset_paths = if let Some(asset_path) = asset_path {
        vec![asset_path.to_string()]
    } else {
        project
            .tracks
            .iter()
            .flat_map(|track| track.clips.iter())
            .filter(|clip| !clip.asset_path.is_empty())
            .filter(|clip| {
                video_normalize_relative_path(&clip.asset_path)
                    .ok()
                    .and_then(|path| video_media_kind_for_extension(&path))
                    .is_some_and(|kind| matches!(kind, "audio" | "video"))
            })
            .map(|clip| clip.asset_path.clone())
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>()
    };
    let ffmpeg_path = video_tier1_ffmpeg_path_for_mcp(ffprobe_path);
    let mut source_ranges = std::collections::BTreeMap::<String, Vec<VideoSilenceRange>>::new();
    for path in asset_paths {
        let (abs, rel, kind, _metadata) =
            video_resolve_existing_media_file(root, media_root, &path)?;
        if !matches!(kind, "audio" | "video") {
            if asset_path.is_some() {
                return Err("removeSilences requires an audio or video asset.".to_string());
            }
            continue;
        }
        let ranges = video_tier1_detect_silences_blocking(
            &ffmpeg_path,
            ffprobe_path,
            &abs,
            noise_db,
            min_ms,
        )?;
        source_ranges.insert(rel, ranges);
    }
    let mut timeline_ranges = Vec::<(u64, u64)>::new();
    for track in &project.tracks {
        for clip in &track.clips {
            let Some(ranges) = source_ranges.get(&clip.asset_path) else {
                continue;
            };
            let speed = clip.speed.max(0.0001);
            let source_from = clip.source_in_ms;
            let source_to = source_from
                .saturating_add(video_mcp_round_u64(clip.duration_ms as f64 * speed));
            for range in ranges {
                let from = range.start_ms.max(source_from);
                let to = range.end_ms.min(source_to);
                if to <= from {
                    continue;
                }
                if track.locked {
                    return Err(format!(
                        "silence removal is blocked because track {} is locked",
                        track.id
                    ));
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
        state.summaries.push("no silences found".to_string());
        return Ok(());
    }
    let effective_ranges = video_mcp_plan_effective_ranges(project, timeline_ranges, None)?;
    let effective_start = state.effective_ranges.len();
    for (start, end) in effective_ranges.iter().rev().copied() {
        let plan = video_mcp_plan_ripple_delete_range(project, start, end, None)?;
        video_mcp_apply_ripple_delete_plan(project, &plan, state);
    }
    state.effective_ranges.truncate(effective_start);
    state.effective_ranges.extend(effective_ranges.iter().copied());
    state
        .summaries
        .push(format!("removed {} silence range(s)", effective_ranges.len()));
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct VideoTier1HardwareEncoder {
    name: String,
    vaapi: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct VideoExportEncodersResponse {
    hardware_available: bool,
    encoder: String,
}

static VIDEO_TIER1_ENCODER_CACHE: std::sync::OnceLock<
    std::sync::Mutex<std::collections::HashMap<String, std::collections::BTreeSet<String>>>,
> = std::sync::OnceLock::new();

fn video_tier1_probe_encoder_names(ffmpeg_path: &str) -> std::collections::BTreeSet<String> {
    let key = video_ffmpeg_drawtext_cache_key(ffmpeg_path);
    let cache = VIDEO_TIER1_ENCODER_CACHE
        .get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()));
    if let Ok(guard) = cache.lock() {
        if let Some(encoders) = guard.get(&key) {
            return encoders.clone();
        }
    }
    let encoders = run_command_capture(
        ffmpeg_path,
        &["-hide_banner", "-encoders"],
        None,
        std::time::Duration::from_secs(8),
        None,
    )
    .ok()
    .map(|capture| command_output_text(&capture.stdout, &capture.stderr))
    .map(|output| {
        output
            .lines()
            .filter_map(|line| line.split_whitespace().nth(1))
            .map(ToOwned::to_owned)
            .collect::<std::collections::BTreeSet<_>>()
    })
    .unwrap_or_default();
    if let Ok(mut guard) = cache.lock() {
        guard.insert(key, encoders.clone());
    }
    encoders
}

fn video_tier1_select_hardware_encoder(
    platform: &str,
    encoders: &std::collections::BTreeSet<String>,
) -> Option<VideoTier1HardwareEncoder> {
    let candidates: &[(&str, bool)] = match platform {
        "macos" => &[
            ("h264_videotoolbox", false),
            ("hevc_videotoolbox", false),
        ],
        "windows" => &[
            ("h264_nvenc", false),
            ("h264_qsv", false),
            ("h264_amf", false),
        ],
        "linux" => &[("h264_vaapi", true)],
        _ => &[],
    };
    candidates.iter().find_map(|(name, vaapi)| {
        encoders.contains(*name).then(|| VideoTier1HardwareEncoder {
            name: (*name).to_string(),
            vaapi: *vaapi,
        })
    })
}

fn video_tier1_platform_name() -> &'static str {
    match std::env::consts::OS {
        "macos" => "macos",
        "windows" => "windows",
        "linux" => "linux",
        other => other,
    }
}

#[tauri::command]
fn video_export_encoders(
    app: tauri::AppHandle,
) -> Result<VideoExportEncodersResponse, String> {
    let status = video_tools_status_for(&app);
    let Some(ffmpeg_path) = status.ffmpeg.path else {
        return Ok(VideoExportEncodersResponse {
            hardware_available: false,
            encoder: "libx264".to_string(),
        });
    };
    let encoders = video_tier1_probe_encoder_names(&ffmpeg_path);
    let hardware =
        video_tier1_select_hardware_encoder(video_tier1_platform_name(), &encoders);
    Ok(VideoExportEncodersResponse {
        hardware_available: hardware.is_some(),
        encoder: hardware
            .map(|encoder| encoder.name)
            .unwrap_or_else(|| "libx264".to_string()),
    })
}

fn video_tier1_codec_args(
    format: &str,
    crf: u8,
    preset: &str,
    hardware: Option<&VideoTier1HardwareEncoder>,
) -> Vec<String> {
    if format == "webm" {
        return vec![
            "-c:v".to_string(),
            "libvpx-vp9".to_string(),
            "-crf".to_string(),
            crf.to_string(),
            "-b:v".to_string(),
            "0".to_string(),
            "-c:a".to_string(),
            "libopus".to_string(),
        ];
    }
    let mut args = match hardware.map(|encoder| encoder.name.as_str()) {
        Some("h264_videotoolbox") => vec![
            "-c:v".to_string(),
            "h264_videotoolbox".to_string(),
            "-q:v".to_string(),
            crf.to_string(),
        ],
        Some("hevc_videotoolbox") => vec![
            "-c:v".to_string(),
            "hevc_videotoolbox".to_string(),
            "-q:v".to_string(),
            crf.to_string(),
            "-tag:v".to_string(),
            "hvc1".to_string(),
        ],
        Some("h264_nvenc") => vec![
            "-c:v".to_string(),
            "h264_nvenc".to_string(),
            "-preset".to_string(),
            "p4".to_string(),
            "-cq".to_string(),
            crf.to_string(),
            "-b:v".to_string(),
            "0".to_string(),
        ],
        Some("h264_qsv") => vec![
            "-c:v".to_string(),
            "h264_qsv".to_string(),
            "-global_quality".to_string(),
            crf.to_string(),
        ],
        Some("h264_amf") => vec![
            "-c:v".to_string(),
            "h264_amf".to_string(),
            "-quality".to_string(),
            "quality".to_string(),
            "-qp_i".to_string(),
            crf.to_string(),
            "-qp_p".to_string(),
            crf.to_string(),
        ],
        Some("h264_vaapi") => vec![
            "-c:v".to_string(),
            "h264_vaapi".to_string(),
            "-qp".to_string(),
            crf.to_string(),
        ],
        _ => vec![
            "-c:v".to_string(),
            "libx264".to_string(),
            "-preset".to_string(),
            preset.to_string(),
            "-crf".to_string(),
            crf.to_string(),
        ],
    };
    args.extend([
        "-pix_fmt".to_string(),
        "yuv420p".to_string(),
        "-c:a".to_string(),
        "aac".to_string(),
        "-b:a".to_string(),
        "192k".to_string(),
        "-movflags".to_string(),
        "+faststart".to_string(),
    ]);
    args
}

fn video_tier1_export_ffmpeg_args(
    media_clips: &[VideoExportMediaClip],
    filter_complex: &str,
    video_output: &str,
    audio_output: &str,
    format: &str,
    crf: u8,
    preset: &str,
    fps: f64,
    total_ms: u64,
    output_abs: &std::path::Path,
    hardware: Option<&VideoTier1HardwareEncoder>,
) -> Vec<String> {
    let mut args = vec!["-nostdin".to_string()];
    if hardware.is_some_and(|encoder| encoder.vaapi) {
        args.extend([
            "-vaapi_device".to_string(),
            "/dev/dri/renderD128".to_string(),
        ]);
    }
    for clip in media_clips {
        if clip.kind == "image" {
            let (head_ms, tail_ms) =
                video_tier1_media_transition_handles(media_clips, clip.input_index);
            args.extend([
                "-loop".to_string(),
                "1".to_string(),
                "-t".to_string(),
                video_ffmpeg_seconds(
                    clip.duration_ms
                        .saturating_add(head_ms)
                        .saturating_add(tail_ms),
                ),
            ]);
        }
        args.push("-i".to_string());
        args.push(clip.abs_path.to_string_lossy().to_string());
    }
    let (filter, mapped_video) = if hardware.is_some_and(|encoder| encoder.vaapi) {
        (
            format!("{filter_complex};[{video_output}]format=nv12,hwupload[vhw]"),
            "vhw",
        )
    } else {
        (filter_complex.to_string(), video_output)
    };
    args.extend([
        "-filter_complex".to_string(),
        filter,
        "-map".to_string(),
        format!("[{mapped_video}]"),
        "-map".to_string(),
        format!("[{audio_output}]"),
    ]);
    args.extend(video_tier1_codec_args(format, crf, preset, hardware));
    args.extend([
        "-r".to_string(),
        video_ffmpeg_number(fps),
        "-t".to_string(),
        video_ffmpeg_seconds(total_ms),
        "-progress".to_string(),
        "pipe:1".to_string(),
        "-nostats".to_string(),
        "-y".to_string(),
        "-f".to_string(),
        if format == "webm" {
            "webm".to_string()
        } else {
            "mp4".to_string()
        },
        output_abs.to_string_lossy().to_string(),
    ]);
    args
}

enum VideoTier1ExportAttempt {
    Success,
    Cancelled,
    Failed(String),
}

fn video_tier1_run_export_attempt(
    app: &tauri::AppHandle,
    ffmpeg_path: &str,
    args: &[String],
    job_id: &str,
    repo_display: &str,
    total_ms: u64,
    cancel: &std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> Result<VideoTier1ExportAttempt, String> {
    let mut command = std::process::Command::new(ffmpeg_path);
    apply_desktop_command_environment(&mut command);
    command
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("Unable to start ffmpeg export: {error}"))?;
    let stderr_lines = std::sync::Arc::new(std::sync::Mutex::new(
        std::collections::VecDeque::<String>::new(),
    ));
    if let Some(stderr) = child.stderr.take() {
        let stderr_lines_for_thread = stderr_lines.clone();
        std::thread::spawn(move || {
            use std::io::BufRead as _;
            for line in std::io::BufReader::new(stderr).lines().flatten() {
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
        for line in std::io::BufReader::new(stdout).lines().flatten() {
            if cancel.load(std::sync::atomic::Ordering::Acquire) {
                let _ = child.kill();
                cancelled = true;
                break;
            }
            if let Some(out_ms) = video_parse_ffmpeg_progress_ms(&line) {
                if last_emit.elapsed()
                    >= std::time::Duration::from_millis(VIDEO_EXPORT_PROGRESS_INTERVAL_MS)
                {
                    video_emit_export_progress(
                        app,
                        repo_display,
                        job_id,
                        "rendering",
                        Some(((out_ms as f64 / total_ms as f64) * 100.0).clamp(0.0, 100.0)),
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
        return Ok(VideoTier1ExportAttempt::Cancelled);
    }
    if status.success() {
        Ok(VideoTier1ExportAttempt::Success)
    } else {
        let detail = stderr_lines
            .lock()
            .ok()
            .map(|lines| lines.iter().cloned().collect::<Vec<_>>().join("\n"))
            .unwrap_or_default();
        Ok(VideoTier1ExportAttempt::Failed(if detail.is_empty() {
            "ffmpeg export failed.".to_string()
        } else {
            format!("ffmpeg export failed: {detail}")
        }))
    }
}

fn video_tier1_emit_export_completion(
    app: &tauri::AppHandle,
    repo_path: &str,
    job_id: &str,
    output_path: &str,
    width: u32,
    height: u32,
    duration_ms: u64,
    warnings: &[String],
) {
    let result = serde_json::json!({
        "path": output_path,
        "width": width,
        "height": height,
        "durationMs": duration_ms,
        "warnings": warnings,
    });
    let status = serde_json::json!({
        "jobId": job_id,
        "state": "done",
        "percent": 100.0,
        "done": true,
        "error": serde_json::Value::Null,
        "outputPath": output_path,
        "warnings": warnings,
        "result": result,
    });
    if let Ok(mut statuses) = video_export_statuses().lock() {
        statuses.insert(job_id.to_string(), status);
    }
    let _ = app.emit(
        VIDEO_EXPORT_PROGRESS_EVENT,
        serde_json::json!({
            "repoPath": repo_path,
            "jobId": job_id,
            "state": "done",
            "percent": 100.0,
            "outTimeMs": duration_ms,
            "totalMs": duration_ms,
            "message": "Video export finished.",
            "done": true,
            "error": serde_json::Value::Null,
            "outputPath": output_path,
            "warnings": warnings,
            "path": output_path,
            "width": width,
            "height": height,
            "durationMs": duration_ms,
            "result": result,
        }),
    );
}

static VIDEO_TIER1_LAST_COMPLETION_PATH: std::sync::OnceLock<
    std::sync::Mutex<Option<std::path::PathBuf>>,
> = std::sync::OnceLock::new();

fn video_tier1_record_completion_path(path: &std::path::Path) {
    if let Ok(mut last) = VIDEO_TIER1_LAST_COMPLETION_PATH
        .get_or_init(|| std::sync::Mutex::new(None))
        .lock()
    {
        *last = Some(path.to_path_buf());
    }
}

fn video_tier1_draft_paths(
    draft_dir: &std::path::Path,
    job_id: &str,
) -> (std::path::PathBuf, std::path::PathBuf) {
    let final_path = draft_dir.join(format!("{job_id}.mp4"));
    let partial_path = draft_dir.join(format!("{job_id}.mp4.partial"));
    (final_path, partial_path)
}

fn video_tier1_prune_drafts(draft_dir: &std::path::Path) {
    let protected = VIDEO_TIER1_LAST_COMPLETION_PATH
        .get_or_init(|| std::sync::Mutex::new(None))
        .lock()
        .ok()
        .and_then(|path| path.clone());
    let mut files = std::fs::read_dir(draft_dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|entry| {
            let path = entry.path();
            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            path.is_file() && (name.ends_with(".mp4") || name.ends_with(".mp4.partial"))
        })
        .filter_map(|entry| {
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((modified, entry.path()))
        })
        .collect::<Vec<_>>();
    files.sort_by(|left, right| right.0.cmp(&left.0));
    for (_, path) in files.into_iter().skip(3) {
        if protected.as_ref() != Some(&path) {
            let _ = std::fs::remove_file(path);
        }
    }
}

#[tauri::command]
async fn video_draft_render(
    app: tauri::AppHandle,
    repo_path: String,
    project_rel_path: String,
    start_ms: u64,
    end_ms: u64,
    height: Option<u32>,
) -> Result<VideoJobStartResult, String> {
    if end_ms <= start_ms {
        return Err("Draft render endMs must be greater than startMs.".to_string());
    }
    let repo_for_project = repo_path.clone();
    let project_for_worker = project_rel_path.clone();
    let requested_height = height.unwrap_or(480);
    let (width, height) = tauri::async_runtime::spawn_blocking(move || {
        let (root, media_root) = video_workspace_media_root(&repo_for_project)?;
        let project_abs =
            video_resolve_project_abs(&root, &media_root, &project_for_worker)?;
        let project = video_project_load_value(&project_abs)?;
        let settings = project.get("settings").unwrap_or(&serde_json::Value::Null);
        let source_width = video_json_u64(settings, "width", 1920).max(16) as f64;
        let source_height = video_json_u64(settings, "height", 1080).max(16) as f64;
        let height = video_mcp_even_dimension(requested_height.clamp(16, 4320));
        let width = video_mcp_even_dimension(
            (height as f64 * source_width / source_height).round() as u32,
        );
        Ok::<_, String>((width, height))
    })
    .await
    .map_err(|error| format!("Video draft setup worker failed: {error}"))??;
    video_export_start(
        app,
        repo_path,
        project_rel_path,
        VideoExportOptions {
            file_name: Some(format!("draft-{}", video_now_millis())),
            width: Some(width),
            height: Some(height),
            fps: None,
            format: Some("mp4".to_string()),
            crf: None,
            preset: None,
            range_start_ms: Some(start_ms),
            range_end_ms: Some(end_ms),
            output_dir: None,
            hardware_encode: None,
            draft: true,
        },
    )
    .await
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VideoInterchangeExportResponse {
    path: String,
    warnings: Vec<String>,
}

fn video_tier1_xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn video_tier1_file_url(path: &std::path::Path) -> String {
    let mut raw = path.to_string_lossy().replace('\\', "/");
    if raw.as_bytes().get(1) == Some(&b':') && !raw.starts_with('/') {
        raw.insert(0, '/');
    }
    let encoded = raw
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'/'
            | b':'
            | b'-'
            | b'_'
            | b'.'
            | b'~' => (byte as char).to_string(),
            _ => format!("%{byte:02X}"),
        })
        .collect::<String>();
    format!("file://{encoded}")
}

fn video_tier1_interchange_output_path(
    root: &std::path::Path,
    out_path: &str,
) -> Result<std::path::PathBuf, String> {
    let raw = out_path.trim();
    if raw.is_empty() {
        return Err("Interchange outPath is required.".to_string());
    }
    let path = std::path::PathBuf::from(raw);
    let abs = if path.is_absolute() {
        path
    } else {
        root.join(video_normalize_relative_path(raw)?)
    };
    if !abs.is_absolute() {
        return Err("Unable to resolve interchange outPath.".to_string());
    }
    if let Some(parent) = abs.parent() {
        if abs.starts_with(root) {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Unable to create interchange directory: {error}"))?;
        } else if !parent.is_dir() {
            return Err(format!(
                "Interchange output directory does not exist: {}",
                parent.display()
            ));
        }
    }
    Ok(abs)
}

#[derive(Debug, Clone, Copy)]
struct VideoTier1InterchangeRate {
    fps: f64,
    timebase: u64,
    ntsc: bool,
    fcpx_frame_num: u64,
    fcpx_frame_den: u64,
}

impl VideoTier1InterchangeRate {
    fn from_fps(fps: f64) -> Self {
        let fps = fps.max(1.0);
        for (actual, timebase, numerator, denominator) in [
            (24_000.0 / 1001.0, 24, 1001, 24_000),
            (30_000.0 / 1001.0, 30, 1001, 30_000),
            (60_000.0 / 1001.0, 60, 1001, 60_000),
        ] {
            if (fps - actual).abs() < 0.02 {
                return Self {
                    fps: actual,
                    timebase,
                    ntsc: true,
                    fcpx_frame_num: numerator,
                    fcpx_frame_den: denominator,
                };
            }
        }
        let timebase = fps.round().max(1.0) as u64;
        Self {
            fps: timebase as f64,
            timebase,
            ntsc: false,
            fcpx_frame_num: 100,
            fcpx_frame_den: timebase.saturating_mul(100),
        }
    }

    fn frame(self, ms: u64) -> u64 {
        ((ms as f64 / 1000.0) * self.fps).round().max(0.0) as u64
    }

    fn duration_frames(self, ms: u64) -> u64 {
        let frames = self.frame(ms);
        if ms > 0 { frames.max(1) } else { 0 }
    }

    fn fcpx_time(self, frames: u64) -> String {
        if frames == 0 {
            "0s".to_string()
        } else {
            format!(
                "{}/{}s",
                frames.saturating_mul(self.fcpx_frame_num),
                self.fcpx_frame_den
            )
        }
    }

    fn frame_duration(self) -> String {
        format!("{}/{}s", self.fcpx_frame_num, self.fcpx_frame_den)
    }

    fn xmeml_rate(self) -> String {
        format!(
            "<rate><timebase>{}</timebase><ntsc>{}</ntsc></rate>",
            self.timebase,
            if self.ntsc { "TRUE" } else { "FALSE" }
        )
    }
}

fn video_tier1_clip_has_unmapped_fx(clip: &serde_json::Value) -> bool {
    video_tier1_fx_from_value(clip.get("fx"))
        .map(|fx| fx != VideoTier1Fx::default())
        .unwrap_or(true)
}

fn video_tier1_clip_has_crop(clip: &serde_json::Value) -> bool {
    video_tier1_crop_from_value(clip.get("crop"))
        .map(|crop| crop != VideoTier1Crop::default())
        .unwrap_or(true)
}

fn video_tier1_fcpx_interp(easing: &str) -> &'static str {
    match easing {
        "ease-in" => "easeIn",
        "ease-out" => "easeOut",
        "ease-in-out" | "smooth" => "ease",
        _ => "linear",
    }
}

fn video_tier1_fcpx_opacity_xml(
    clip: &serde_json::Value,
    rate: VideoTier1InterchangeRate,
) -> String {
    let transform = clip.get("transform").unwrap_or(&serde_json::Value::Null);
    let amount = video_json_f64(transform, "opacity", 1.0).clamp(0.0, 1.0);
    let frames = clip
        .get("kf")
        .and_then(|kf| kf.get("opacity"))
        .and_then(|value| value.as_array());
    let mut xml = format!(
        "<adjust-blend amount=\"{}\">",
        video_ffmpeg_number(amount)
    );
    if let Some(frames) = frames.filter(|frames| !frames.is_empty()) {
        xml.push_str("<param name=\"amount\"><keyframeAnimation>");
        for frame in frames {
            xml.push_str(&format!(
                "<keyframe time=\"{}\" value=\"{}\" interp=\"{}\"/>",
                rate.fcpx_time(rate.frame(video_json_u64(frame, "atMs", 0))),
                video_ffmpeg_number(video_json_f64(frame, "value", amount).clamp(0.0, 1.0)),
                video_tier1_fcpx_interp(&video_json_string(frame, "easing", "linear")),
            ));
        }
        xml.push_str("</keyframeAnimation></param>");
    }
    xml.push_str("</adjust-blend>");
    xml
}

fn video_tier1_collect_interchange_warnings(
    project: &serde_json::Value,
    target: &str,
) -> Vec<String> {
    let mut warnings = Vec::new();
    for track in project
        .get("tracks")
        .and_then(|value| value.as_array())
        .into_iter()
        .flatten()
    {
        for clip in track
            .get("clips")
            .and_then(|value| value.as_array())
            .into_iter()
            .flatten()
        {
            let clip_id = video_json_string(clip, "id", "unknown");
            if video_tier1_clip_has_unmapped_fx(clip) {
                warnings.push(format!(
                    "Clip {clip_id} effects/LUT/chroma key are not mapped to {target}."
                ));
            }
            if video_tier1_clip_has_crop(clip) {
                warnings.push(format!("Clip {clip_id} crop is not mapped to {target}."));
            }
            if target == "Premiere XML"
                && (video_json_f64(clip, "speed", 1.0) - 1.0).abs() > 0.0001
            {
                warnings.push(format!(
                    "Clip {clip_id} speed is not encoded in Premiere XML; source trims reflect the requested speed."
                ));
            }
            let gain = clip.get("gain").unwrap_or(&serde_json::Value::Null);
            if (video_json_f64(gain, "level", 1.0) - 1.0).abs() > 0.0001
                || gain
                    .get("keyframes")
                    .and_then(|value| value.as_array())
                    .is_some_and(|frames| !frames.is_empty())
            {
                warnings.push(format!(
                    "Clip {clip_id} audio gain automation is not mapped to {target}."
                ));
            }
            if clip
                .get("kf")
                .and_then(|value| value.as_object())
                .into_iter()
                .flat_map(|object| object.values())
                .filter_map(|value| value.as_array())
                .flatten()
                .any(|frame| {
                    matches!(
                        frame.get("easing").and_then(|value| value.as_str()),
                        Some("ease-in" | "ease-out" | "ease-in-out")
                    )
                })
            {
                warnings.push(format!(
                    "Clip {clip_id} cubic-bezier keyframe easing is approximated in {target}."
                ));
            }
            if video_json_string(track, "kind", "") == "text" {
                warnings.push(format!(
                    "Text clip {clip_id} title styling is approximated in {target}."
                ));
                let words = clip
                    .get("words")
                    .and_then(|value| value.as_array())
                    .map(Vec::len)
                    .unwrap_or(0);
                let anim = video_json_string(clip, "anim", "none");
                if words > 0 || anim != "none" {
                    warnings.push(format!(
                        "Text clip {clip_id} word timing/animation is exported statically in {target}."
                    ));
                }
            }
        }
        for transition in track
            .get("transitions")
            .and_then(|value| value.as_array())
            .into_iter()
            .flatten()
        {
            let kind = video_json_string(transition, "kind", "crossfade");
            if kind != "crossfade" {
                warnings.push(format!(
                    "Transition {} ({kind}) is approximated as a cross dissolve in {target}.",
                    video_json_string(transition, "id", "unknown")
                ));
            }
        }
    }
    warnings
}

fn video_tier1_link_group_kinds(
    project: &serde_json::Value,
) -> std::collections::BTreeMap<String, Vec<(String, String)>> {
    let mut groups = std::collections::BTreeMap::<String, Vec<(String, String)>>::new();
    for track in project
        .get("tracks")
        .and_then(|value| value.as_array())
        .into_iter()
        .flatten()
    {
        let kind = video_json_string(track, "kind", "");
        for clip in track
            .get("clips")
            .and_then(|value| value.as_array())
            .into_iter()
            .flatten()
        {
            let link_id = video_json_string(clip, "linkId", "");
            if !link_id.is_empty() {
                groups.entry(link_id).or_default().push((
                    kind.clone(),
                    video_json_string(clip, "id", "unknown"),
                ));
            }
        }
    }
    groups
}

fn video_tier1_valid_av_link_ids(
    project: &serde_json::Value,
) -> std::collections::BTreeSet<String> {
    video_tier1_link_group_kinds(project)
        .into_iter()
        .filter_map(|(link_id, members)| {
            (members.len() == 2
                && members.iter().filter(|(kind, _)| kind == "video").count() == 1
                && members.iter().filter(|(kind, _)| kind == "audio").count() == 1)
                .then_some(link_id)
        })
        .collect()
}

fn video_tier1_push_unmappable_link_warnings(
    project: &serde_json::Value,
    target: &str,
    warnings: &mut Vec<String>,
) {
    for (link_id, members) in video_tier1_link_group_kinds(project) {
        let valid = members.len() == 2
            && members.iter().filter(|(kind, _)| kind == "video").count() == 1
            && members.iter().filter(|(kind, _)| kind == "audio").count() == 1;
        if !valid {
            warnings.push(format!(
                "Link group {link_id} cannot be mapped unambiguously to {target}."
            ));
        }
    }
}

fn video_tier1_fcpx_span(
    rate: VideoTier1InterchangeRate,
    start_ms: u64,
    duration_ms: u64,
) -> (u64, u64) {
    let start = rate.frame(start_ms);
    let end = rate
        .frame(start_ms.saturating_add(duration_ms))
        .max(start.saturating_add((duration_ms > 0) as u64));
    (start, end.saturating_sub(start))
}

fn video_tier1_fcpx_render_clip(
    clip: &serde_json::Value,
    kind: &str,
    asset_ref: Option<&str>,
    rate: VideoTier1InterchangeRate,
    width: u64,
    height: u64,
    lane: Option<i64>,
    offset_frames_override: Option<u64>,
    style_id: Option<&str>,
    link_mapped: bool,
) -> String {
    let id = video_tier1_xml_escape(&video_json_string(clip, "id", "clip"));
    let (timeline_offset_frames, duration_frames) = video_tier1_fcpx_span(
        rate,
        video_json_u64(clip, "timelineStartMs", 0),
        video_json_u64(clip, "durationMs", 0),
    );
    let offset_frames = offset_frames_override.unwrap_or(timeline_offset_frames);
    let lane_attr = lane
        .filter(|lane| *lane != 0)
        .map(|lane| format!(" lane=\"{lane}\""))
        .unwrap_or_default();
    if kind == "text" {
        let style_id = style_id.unwrap_or("ts1");
        return format!(
            "<title name=\"{}\" ref=\"rTitle\" offset=\"{}\" duration=\"{}\"{}><text><text-style ref=\"{}\">{}</text-style></text><text-style-def id=\"{}\"><text-style/></text-style-def></title>",
            id,
            rate.fcpx_time(offset_frames),
            rate.fcpx_time(duration_frames),
            lane_attr,
            style_id,
            video_tier1_xml_escape(&video_json_string(clip, "text", "")),
            style_id,
        );
    }
    let Some(asset_ref) = asset_ref else {
        return String::new();
    };
    let source_in = rate.frame(video_json_u64(clip, "sourceInMs", 0));
    let speed = video_json_f64(clip, "speed", 1.0).max(0.0001);
    let src_enable = if kind == "audio" {
        "audio"
    } else if link_mapped {
        "video"
    } else {
        "all"
    };
    let role_attr = link_mapped
        .then_some(" audioRole=\"dialogue\"")
        .unwrap_or("");
    let mut xml = format!(
        "<asset-clip name=\"{}\" ref=\"{}\" offset=\"{}\" start=\"{}\" duration=\"{}\" srcEnable=\"{}\"{}{}>",
        id,
        asset_ref,
        rate.fcpx_time(offset_frames),
        rate.fcpx_time(source_in),
        rate.fcpx_time(duration_frames),
        src_enable,
        role_attr,
        lane_attr,
    );
    if (speed - 1.0).abs() > 0.0001 {
        xml.push_str(&format!(
            "<timeMap><timept time=\"0s\" value=\"{}\"/><timept time=\"{}\" value=\"{}\"/></timeMap>",
            rate.fcpx_time(source_in),
            rate.fcpx_time(duration_frames),
            rate.fcpx_time(source_in.saturating_add(
                (duration_frames as f64 * speed).round() as u64
            )),
        ));
    }
    if kind == "video" {
        let transform = clip.get("transform").unwrap_or(&serde_json::Value::Null);
        xml.push_str(&format!(
            "<adjust-transform position=\"{} {}\" scale=\"{} {}\"/>",
            video_ffmpeg_number(video_json_f64(transform, "x", 0.0) * width as f64),
            video_ffmpeg_number(video_json_f64(transform, "y", 0.0) * height as f64),
            video_ffmpeg_number(video_json_f64(transform, "scale", 1.0)),
            video_ffmpeg_number(video_json_f64(transform, "scale", 1.0)),
        ));
        xml.push_str(&video_tier1_fcpx_opacity_xml(clip, rate));
    }
    xml.push_str("</asset-clip>");
    xml
}

fn video_tier1_xml_id(prefix: &str, value: &str) -> String {
    let normalized = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>();
    format!("{prefix}-{}", normalized.trim_matches('-'))
}

#[derive(Debug, Clone)]
struct VideoTier1XmemlLink {
    clip_id: String,
    media_type: &'static str,
    track_index: usize,
    clip_index: usize,
}

fn video_tier1_xmeml_links_xml(links: &[VideoTier1XmemlLink]) -> String {
    let mut xml = String::new();
    for link in links {
        xml.push_str(&format!(
            "<link><linkclipref>{}</linkclipref><mediatype>{}</mediatype><trackindex>{}</trackindex><clipindex>{}</clipindex><groupindex>1</groupindex></link>",
            video_tier1_xml_escape(&link.clip_id),
            link.media_type,
            link.track_index,
            link.clip_index,
        ));
    }
    xml
}

fn video_tier1_xmeml_keyframes_xml(
    clip: &serde_json::Value,
    rate: VideoTier1InterchangeRate,
) -> String {
    let mut xml = String::new();
    for prop in ["x", "y", "scale", "opacity"] {
        let Some(frames) = clip
            .get("kf")
            .and_then(|kf| kf.get(prop))
            .and_then(|value| value.as_array())
            .filter(|frames| !frames.is_empty())
        else {
            continue;
        };
        xml.push_str(&format!(
            "<parameter><parameterid>{}</parameterid><name>{}</name>",
            prop,
            video_tier1_xml_escape(prop)
        ));
        for frame in frames {
            let mut value = video_json_f64(frame, "value", 0.0);
            if prop == "opacity" {
                value = value.clamp(0.0, 1.0);
            }
            xml.push_str(&format!(
                "<keyframe><when>{}</when><value>{}</value></keyframe>",
                rate.frame(video_json_u64(frame, "atMs", 0)),
                video_ffmpeg_number(value),
            ));
        }
        xml.push_str("</parameter>");
    }
    xml
}

fn video_tier1_build_fcpxml(
    root: &std::path::Path,
    media_root: &std::path::Path,
    project: &serde_json::Value,
) -> Result<(String, Vec<String>), String> {
    let settings = project.get("settings").unwrap_or(&serde_json::Value::Null);
    let width = video_json_u64(settings, "width", 1920);
    let height = video_json_u64(settings, "height", 1080);
    let rate = VideoTier1InterchangeRate::from_fps(video_json_f64(settings, "fps", 30.0));
    let tracks = project
        .get("tracks")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let mut assets = std::collections::BTreeMap::<String, String>::new();
    for track in &tracks {
        for clip in track
            .get("clips")
            .and_then(|value| value.as_array())
            .into_iter()
            .flatten()
        {
            let path = video_json_string(clip, "assetPath", "");
            if !path.is_empty() && !assets.contains_key(&path) {
                assets.insert(path, format!("r{}", assets.len() + 2));
            }
        }
    }
    let mut xml = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE fcpxml>\n<fcpxml version=\"1.10\"><resources><format id=\"r1\" name=\"FFVideoFormat\" frameDuration=\"{}\" width=\"{width}\" height=\"{height}\"/><effect id=\"rTitle\" name=\"Basic Title\" uid=\".../Titles.localized/Bumper:Opener.localized/Basic Title.localized/Basic Title.moti\"/>",
        rate.frame_duration(),
    );
    for (path, id) in &assets {
        let abs = video_resolve_media_abs(root, media_root, path)?;
        xml.push_str(&format!(
            "<asset id=\"{}\" name=\"{}\" start=\"0s\" hasVideo=\"1\" hasAudio=\"1\"><media-rep kind=\"original-media\" src=\"{}\"/></asset>",
            id,
            video_tier1_xml_escape(
                abs.file_name().and_then(|value| value.to_str()).unwrap_or(path)
            ),
            video_tier1_xml_escape(&video_tier1_file_url(&abs))
        ));
    }
    let total_ms = tracks
        .iter()
        .flat_map(|track| {
            track
                .get("clips")
                .and_then(|value| value.as_array())
                .into_iter()
                .flatten()
        })
        .map(|clip| {
            video_json_u64(clip, "timelineStartMs", 0)
                .saturating_add(video_json_u64(clip, "durationMs", 0))
        })
        .max()
        .unwrap_or(0);
    let total_frames = rate.duration_frames(total_ms);
    xml.push_str(&format!(
        "</resources><library><event name=\"Diff Forge\"><project name=\"{}\"><sequence format=\"r1\" duration=\"{}\"><spine>",
        video_tier1_xml_escape(&video_json_string(project, "name", "Untitled")),
        rate.fcpx_time(total_frames)
    ));
    #[derive(Clone)]
    struct SpineSegment {
        start_ms: u64,
        duration_ms: u64,
        clip: Option<serde_json::Value>,
        children: Vec<(String, serde_json::Value, i64)>,
    }
    let primary_track_index = tracks
        .iter()
        .position(|track| video_json_string(track, "kind", "") == "video");
    let mut segments = Vec::<SpineSegment>::new();
    let mut connected = Vec::<(String, serde_json::Value, i64)>::new();
    let mut primary_clips = primary_track_index
        .and_then(|index| tracks[index].get("clips"))
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    primary_clips.sort_by_key(|clip| video_json_u64(clip, "timelineStartMs", 0));
    let mut cursor = 0u64;
    for clip in &primary_clips {
        let start = video_json_u64(clip, "timelineStartMs", 0);
        let duration = video_json_u64(clip, "durationMs", 0);
        if start < cursor {
            connected.push(("video".to_string(), clip.clone(), 1));
            continue;
        }
        if start > cursor {
            segments.push(SpineSegment {
                start_ms: cursor,
                duration_ms: start - cursor,
                clip: None,
                children: Vec::new(),
            });
        }
        segments.push(SpineSegment {
            start_ms: start,
            duration_ms: duration,
            clip: Some(clip.clone()),
            children: Vec::new(),
        });
        cursor = start.saturating_add(duration);
    }
    if cursor < total_ms || segments.is_empty() {
        segments.push(SpineSegment {
            start_ms: cursor,
            duration_ms: total_ms.saturating_sub(cursor).max((total_ms == 0) as u64),
            clip: None,
            children: Vec::new(),
        });
    }
    let mut audio_lane = 0i64;
    for (track_index, track) in tracks.iter().enumerate() {
        if Some(track_index) == primary_track_index {
            continue;
        }
        let kind = video_json_string(track, "kind", "video");
        let lane = if kind == "audio" {
            audio_lane += 1;
            -audio_lane
        } else {
            (track_index + 1) as i64
        };
        for clip in track
            .get("clips")
            .and_then(|value| value.as_array())
            .into_iter()
            .flatten()
        {
            connected.push((kind.clone(), clip.clone(), lane));
        }
    }
    for child in connected {
        let child_start = video_json_u64(&child.1, "timelineStartMs", 0);
        let owner = segments
            .iter()
            .position(|segment| {
                child_start >= segment.start_ms
                    && child_start < segment.start_ms.saturating_add(segment.duration_ms)
            })
            .unwrap_or_else(|| segments.len().saturating_sub(1));
        segments[owner].children.push(child);
    }
    let valid_link_ids = video_tier1_valid_av_link_ids(project);
    let primary_transitions = primary_track_index
        .and_then(|index| tracks[index].get("transitions"))
        .and_then(|value| value.as_array())
        .into_iter()
        .flatten()
        .map(|transition| {
            (
                video_json_string(transition, "afterClipId", ""),
                transition.clone(),
            )
        })
        .collect::<std::collections::BTreeMap<_, _>>();
    let mut style_index = 0usize;
    for segment in segments {
        let mut children_xml = String::new();
        for (kind, child, lane) in segment.children {
            let path = video_json_string(&child, "assetPath", "");
            let link_mapped = valid_link_ids.contains(&video_json_string(&child, "linkId", ""));
            let anchor_start_frames = segment
                .clip
                .as_ref()
                .map(|clip| rate.frame(video_json_u64(clip, "sourceInMs", 0)))
                .unwrap_or(0);
            let child_offset_frames = anchor_start_frames.saturating_add(
                rate.frame(video_json_u64(&child, "timelineStartMs", 0))
                    .saturating_sub(rate.frame(segment.start_ms)),
            );
            let style_id = if kind == "text" {
                style_index += 1;
                Some(format!("ts{style_index}"))
            } else {
                None
            };
            children_xml.push_str(&video_tier1_fcpx_render_clip(
                &child,
                &kind,
                assets.get(&path).map(String::as_str),
                rate,
                width,
                height,
                Some(lane),
                Some(child_offset_frames),
                style_id.as_deref(),
                link_mapped,
            ));
        }
        if let Some(clip) = segment.clip {
            let path = video_json_string(&clip, "assetPath", "");
            let link_mapped = valid_link_ids.contains(&video_json_string(&clip, "linkId", ""));
            let mut parent = video_tier1_fcpx_render_clip(
                &clip,
                "video",
                assets.get(&path).map(String::as_str),
                rate,
                width,
                height,
                None,
                None,
                None,
                link_mapped,
            );
            if let Some(prefix) = parent.strip_suffix("</asset-clip>") {
                parent = format!("{prefix}{children_xml}</asset-clip>");
            }
            xml.push_str(&parent);
            let id = video_json_string(&clip, "id", "");
            let boundary_ms = segment.start_ms.saturating_add(segment.duration_ms);
            let has_adjacent_right = primary_clips.iter().any(|right| {
                video_json_u64(right, "timelineStartMs", 0) == boundary_ms
                    && video_json_string(right, "id", "") != id
            });
            if has_adjacent_right {
                if let Some(transition) = primary_transitions.get(&id) {
                    let duration_ms = video_json_u64(transition, "durationMs", 0);
                    let (before_ms, _) = video_tier1_transition_halves(duration_ms);
                    xml.push_str(&format!(
                        "<transition name=\"Cross Dissolve\" offset=\"{}\" duration=\"{}\"/>",
                        rate.fcpx_time(rate.frame(boundary_ms.saturating_sub(before_ms))),
                        rate.fcpx_time(rate.duration_frames(duration_ms)),
                    ));
                }
            }
        } else {
            let (start_frames, duration_frames) =
                video_tier1_fcpx_span(rate, segment.start_ms, segment.duration_ms);
            xml.push_str(&format!(
                "<gap name=\"Gap\" offset=\"{}\" start=\"0s\" duration=\"{}\">{}</gap>",
                rate.fcpx_time(start_frames),
                rate.fcpx_time(duration_frames),
                children_xml,
            ));
        }
    }
    xml.push_str("</spine></sequence></project></event></library></fcpxml>");
    let mut warnings = video_tier1_collect_interchange_warnings(project, "FCPXML");
    video_tier1_push_unmappable_link_warnings(project, "FCPXML", &mut warnings);
    Ok((xml, warnings))
}

fn video_tier1_build_premiere_xml(
    root: &std::path::Path,
    media_root: &std::path::Path,
    project: &serde_json::Value,
    ffprobe_path: Option<&str>,
    fps_overrides: Option<&std::collections::BTreeMap<String, f64>>,
) -> Result<(String, Vec<String>), String> {
    let settings = project.get("settings").unwrap_or(&serde_json::Value::Null);
    let project_rate =
        VideoTier1InterchangeRate::from_fps(video_json_f64(settings, "fps", 30.0));
    let tracks = project
        .get("tracks")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let total_frames = tracks
        .iter()
        .flat_map(|track| {
            track
                .get("clips")
                .and_then(|value| value.as_array())
                .into_iter()
                .flatten()
        })
        .map(|clip| {
            project_rate.frame(
                video_json_u64(clip, "timelineStartMs", 0)
                    .saturating_add(video_json_u64(clip, "durationMs", 0)),
            )
        })
        .max()
        .unwrap_or(0);
    let mut xml = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><!DOCTYPE xmeml><xmeml version=\"5\"><sequence><name>{}</name><duration>{}</duration>{}<media><video>",
        video_tier1_xml_escape(&video_json_string(project, "name", "Untitled")),
        total_frames,
        project_rate.xmeml_rate(),
    );
    let mut track_ordinals = std::collections::BTreeMap::<usize, usize>::new();
    let mut video_ordinal = 0usize;
    let mut audio_ordinal = 0usize;
    for (track_index, track) in tracks.iter().enumerate() {
        if video_json_string(track, "kind", "") == "audio" {
            audio_ordinal += 1;
            track_ordinals.insert(track_index, audio_ordinal);
        } else {
            video_ordinal += 1;
            track_ordinals.insert(track_index, video_ordinal);
        }
    }
    let mut link_groups = std::collections::BTreeMap::<String, Vec<VideoTier1XmemlLink>>::new();
    for (track_index, track) in tracks.iter().enumerate() {
        let kind = video_json_string(track, "kind", "");
        if !matches!(kind.as_str(), "video" | "audio") {
            continue;
        }
        for (clip_index, clip) in track
            .get("clips")
            .and_then(|value| value.as_array())
            .into_iter()
            .flatten()
            .enumerate()
        {
            let link_id = video_json_string(clip, "linkId", "");
            if link_id.is_empty() {
                continue;
            }
            let id = video_json_string(clip, "id", "clip");
            link_groups
                .entry(link_id)
                .or_default()
                .push(VideoTier1XmemlLink {
                    clip_id: video_tier1_xml_id(if kind == "audio" { "a" } else { "v" }, &id),
                    media_type: if kind == "audio" { "audio" } else { "video" },
                    track_index: *track_ordinals.get(&track_index).unwrap_or(&1),
                    clip_index: clip_index + 1,
                });
        }
    }
    let valid_link_groups = link_groups
        .iter()
        .filter(|(_, links)| {
            links.len() == 2
                && links.iter().filter(|link| link.media_type == "video").count() == 1
                && links.iter().filter(|link| link.media_type == "audio").count() == 1
        })
        .map(|(id, links)| (id.clone(), links.clone()))
        .collect::<std::collections::BTreeMap<_, _>>();
    let mut asset_fps_cache = std::collections::BTreeMap::<String, f64>::new();
    let mut warnings = video_tier1_collect_interchange_warnings(project, "Premiere XML");
    for (_track_index, track) in tracks.iter().enumerate() {
        if video_json_string(track, "kind", "") == "audio" {
            continue;
        }
        xml.push_str("<track>");
        let transitions = track
            .get("transitions")
            .and_then(|value| value.as_array())
            .into_iter()
            .flatten()
            .map(|transition| {
                (
                    video_json_string(transition, "afterClipId", ""),
                    transition.clone(),
                )
            })
            .collect::<std::collections::BTreeMap<_, _>>();
        for clip in track
            .get("clips")
            .and_then(|value| value.as_array())
            .into_iter()
            .flatten()
        {
            let id = video_json_string(clip, "id", "clip");
            let start_ms = video_json_u64(clip, "timelineStartMs", 0);
            let duration_ms = video_json_u64(clip, "durationMs", 0);
            let end_ms = start_ms.saturating_add(duration_ms);
            if video_json_string(track, "kind", "") == "text" {
                xml.push_str(&format!(
                    "<generatoritem id=\"{}\"><name>{}</name><duration>{}</duration>{}<start>{}</start><end>{}</end><effect><name>Text</name><effectid>Text</effectid><parameter><parameterid>str</parameterid><name>Text</name><value>{}</value></parameter></effect></generatoritem>",
                    video_tier1_xml_id("g", &id),
                    video_tier1_xml_escape(&id),
                    project_rate.duration_frames(duration_ms),
                    project_rate.xmeml_rate(),
                    project_rate.frame(start_ms),
                    project_rate.frame(end_ms),
                    video_tier1_xml_escape(&video_json_string(clip, "text", ""))
                ));
                continue;
            }
            let path = video_json_string(clip, "assetPath", "");
            if path.is_empty() {
                continue;
            }
            let abs = video_resolve_media_abs(root, media_root, &path)?;
            let source_in = video_json_u64(clip, "sourceInMs", 0);
            let speed = video_json_f64(clip, "speed", 1.0).max(0.0001);
            let source_out = source_in.saturating_add((duration_ms as f64 * speed).round() as u64);
            let asset_fps = if let Some(fps) = fps_overrides
                .and_then(|overrides| overrides.get(&path))
                .copied()
            {
                fps
            } else if let Some(fps) = asset_fps_cache.get(&path).copied() {
                fps
            } else {
                let fps = ffprobe_path
                    .and_then(|probe| video_probe_media(probe, &abs))
                    .and_then(|summary| summary.fps);
                if fps.is_none() {
                    warnings.push(format!(
                        "Clip {id} asset frame rate could not be probed; Premiere source trims use the project frame rate."
                    ));
                }
                let fps = fps.unwrap_or(project_rate.fps);
                asset_fps_cache.insert(path.clone(), fps);
                fps
            };
            let asset_rate = VideoTier1InterchangeRate::from_fps(asset_fps);
            let transform = clip.get("transform").unwrap_or(&serde_json::Value::Null);
            let element_id = video_tier1_xml_id("v", &id);
            xml.push_str(&format!(
                "<clipitem id=\"{}\"><name>{}</name><duration>{}</duration>{}<start>{}</start><end>{}</end><in>{}</in><out>{}</out><file id=\"file-{}\"><name>{}</name><pathurl>{}</pathurl>{}</file><filter><effect><name>Motion</name><effectid>motion</effectid><parameter><parameterid>center-x</parameterid><name>Center X</name><value>{}</value></parameter><parameter><parameterid>center-y</parameterid><name>Center Y</name><value>{}</value></parameter><parameter><parameterid>scale</parameterid><name>Scale</name><value>{}</value></parameter><parameter><parameterid>opacity</parameterid><name>Opacity</name><value>{}</value></parameter>{}</effect></filter>",
                element_id,
                video_tier1_xml_escape(&id),
                project_rate.duration_frames(duration_ms),
                project_rate.xmeml_rate(),
                project_rate.frame(start_ms),
                project_rate.frame(end_ms),
                asset_rate.frame(source_in),
                asset_rate.frame(source_out),
                element_id,
                video_tier1_xml_escape(abs.file_name().and_then(|value| value.to_str()).unwrap_or(&path)),
                video_tier1_xml_escape(&video_tier1_file_url(&abs)),
                asset_rate.xmeml_rate(),
                video_ffmpeg_number(video_json_f64(transform, "x", 0.0)),
                video_ffmpeg_number(video_json_f64(transform, "y", 0.0)),
                video_ffmpeg_number(video_json_f64(transform, "scale", 1.0)),
                video_ffmpeg_number(video_json_f64(transform, "opacity", 1.0).clamp(0.0, 1.0)),
                video_tier1_xmeml_keyframes_xml(clip, project_rate)
            ));
            let link_id = video_json_string(clip, "linkId", "");
            if let Some(links) = valid_link_groups.get(&link_id) {
                xml.push_str(&video_tier1_xmeml_links_xml(links));
            }
            xml.push_str("</clipitem>");
            if let Some(transition) = transitions.get(&id) {
                let duration_ms = video_json_u64(transition, "durationMs", 0);
                let duration_frames = project_rate.duration_frames(duration_ms);
                let cut = project_rate.frame(end_ms);
                let transition_start = cut.saturating_sub(duration_frames / 2);
                xml.push_str(&format!(
                    "<transitionitem><name>Cross Dissolve</name>{}<start>{}</start><end>{}</end><alignment>center</alignment><effect><name>Cross Dissolve</name><effectid>Cross Dissolve</effectid><effectcategory>Dissolve</effectcategory><effecttype>transition</effecttype><mediatype>video</mediatype></effect></transitionitem>",
                    project_rate.xmeml_rate(),
                    transition_start,
                    transition_start.saturating_add(duration_frames),
                ));
            }
        }
        xml.push_str("</track>");
    }
    xml.push_str("</video><audio>");
    for (_track_index, track) in tracks.iter().enumerate() {
        if video_json_string(track, "kind", "") != "audio" {
            continue;
        }
        xml.push_str("<track>");
        for clip in track
            .get("clips")
            .and_then(|value| value.as_array())
            .into_iter()
            .flatten()
        {
            let id = video_json_string(clip, "id", "clip");
            let path = video_json_string(clip, "assetPath", "");
            let abs = video_resolve_media_abs(root, media_root, &path)?;
            let start = video_json_u64(clip, "timelineStartMs", 0);
            let duration = video_json_u64(clip, "durationMs", 0);
            let source_in = video_json_u64(clip, "sourceInMs", 0);
            let speed = video_json_f64(clip, "speed", 1.0).max(0.0001);
            let source_out = source_in.saturating_add((duration as f64 * speed).round() as u64);
            let element_id = video_tier1_xml_id("a", &id);
            xml.push_str(&format!(
                "<clipitem id=\"{}\"><name>{}</name><duration>{}</duration>{}<start>{}</start><end>{}</end><in>{}</in><out>{}</out><file id=\"file-{}\"><name>{}</name><pathurl>{}</pathurl>{}</file>",
                element_id,
                video_tier1_xml_escape(&id),
                project_rate.duration_frames(duration),
                project_rate.xmeml_rate(),
                project_rate.frame(start),
                project_rate.frame(start.saturating_add(duration)),
                project_rate.frame(source_in),
                project_rate.frame(source_out),
                element_id,
                video_tier1_xml_escape(abs.file_name().and_then(|value| value.to_str()).unwrap_or(&path)),
                video_tier1_xml_escape(&video_tier1_file_url(&abs)),
                project_rate.xmeml_rate(),
            ));
            let link_id = video_json_string(clip, "linkId", "");
            if let Some(links) = valid_link_groups.get(&link_id) {
                xml.push_str(&video_tier1_xmeml_links_xml(links));
            }
            xml.push_str("</clipitem>");
        }
        xml.push_str("</track>");
    }
    xml.push_str("</audio></media></sequence></xmeml>");
    video_tier1_push_unmappable_link_warnings(project, "Premiere XML", &mut warnings);
    Ok((xml, warnings))
}

fn video_tier1_write_interchange(
    repo_path: &str,
    project_rel_path: &str,
    out_path: &str,
    premiere: bool,
    ffprobe_path: Option<&str>,
) -> Result<VideoInterchangeExportResponse, String> {
    let (root, media_root) = video_workspace_media_root(repo_path)?;
    let project_abs = video_resolve_project_abs(&root, &media_root, project_rel_path)?;
    let project = video_project_load_value(&project_abs)?;
    let output_abs = video_tier1_interchange_output_path(&root, out_path)?;
    let (xml, warnings) = if premiere {
        video_tier1_build_premiere_xml(&root, &media_root, &project, ffprobe_path, None)?
    } else {
        video_tier1_build_fcpxml(&root, &media_root, &project)?
    };
    std::fs::write(&output_abs, xml)
        .map_err(|error| format!("Unable to write interchange XML: {error}"))?;
    Ok(VideoInterchangeExportResponse {
        path: video_relative_path(&root, &output_abs),
        warnings,
    })
}

#[tauri::command]
async fn video_export_fcpxml(
    app: tauri::AppHandle,
    repo_path: String,
    project_rel_path: String,
    out_path: String,
) -> Result<VideoInterchangeExportResponse, String> {
    let ffprobe_path = video_tools_status_for(&app).ffprobe.path;
    tauri::async_runtime::spawn_blocking(move || {
        video_tier1_write_interchange(
            &repo_path,
            &project_rel_path,
            &out_path,
            false,
            ffprobe_path.as_deref(),
        )
    })
    .await
    .map_err(|error| format!("FCPXML export worker failed: {error}"))?
}

#[tauri::command]
async fn video_export_premiere_xml(
    app: tauri::AppHandle,
    repo_path: String,
    project_rel_path: String,
    out_path: String,
) -> Result<VideoInterchangeExportResponse, String> {
    let ffprobe_path = video_tools_status_for(&app).ffprobe.path;
    tauri::async_runtime::spawn_blocking(move || {
        video_tier1_write_interchange(
            &repo_path,
            &project_rel_path,
            &out_path,
            true,
            ffprobe_path.as_deref(),
        )
    })
    .await
    .map_err(|error| format!("Premiere XML export worker failed: {error}"))?
}

#[cfg(test)]
mod video_tier1_tests {
    use super::*;

    fn assert_close(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() <= 1e-4,
            "expected {expected:.12}, got {actual:.12}"
        );
    }

    fn video_test_tool_available(name: &str) -> bool {
        std::process::Command::new(name)
            .arg("-version")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
    }

    fn video_test_run(command: &mut std::process::Command, label: &str) {
        let output = command.output().unwrap_or_else(|error| panic!("{label}: {error}"));
        assert!(
            output.status.success(),
            "{label}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn video_test_probe_duration(path: &std::path::Path) -> f64 {
        let output = std::process::Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
            ])
            .arg(path)
            .output()
            .expect("probe duration");
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse::<f64>()
            .expect("numeric duration")
    }

    fn video_test_sample_rgb(path: &std::path::Path, at_seconds: &str) -> [u8; 3] {
        let output = std::process::Command::new("ffmpeg")
            .args(["-v", "error", "-ss", at_seconds, "-i"])
            .arg(path)
            .args([
                "-frames:v",
                "1",
                "-vf",
                "scale=1:1,format=rgb24",
                "-f",
                "rawvideo",
                "pipe:1",
            ])
            .output()
            .expect("sample frame");
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        [output.stdout[0], output.stdout[1], output.stdout[2]]
    }

    fn video_test_audio_rms(path: &std::path::Path, at_seconds: &str) -> (f64, f64) {
        let output = std::process::Command::new("ffmpeg")
            .args(["-v", "error", "-i"])
            .arg(path)
            .args([
                "-ss", at_seconds, "-t", "0.2", "-map", "0:a:0", "-ac", "2", "-ar",
                "48000", "-f", "s16le", "pipe:1",
            ])
            .output()
            .expect("sample audio");
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        let mut left = 0.0;
        let mut right = 0.0;
        let mut count = 0.0;
        for frame in output.stdout.chunks_exact(4) {
            let l = i16::from_le_bytes([frame[0], frame[1]]) as f64;
            let r = i16::from_le_bytes([frame[2], frame[3]]) as f64;
            left += l * l;
            right += r * r;
            count += 1.0;
        }
        ((left / count).sqrt(), (right / count).sqrt())
    }

    #[test]
    fn video_tier1_bezier_parity_fixtures_use_twenty_bisections() {
        let fixtures = [
            (
                "ease-in",
                [
                    0.017026412378,
                    0.093464640945,
                    0.315357254221,
                    0.621861443822,
                    0.839427537057,
                ],
            ),
            (
                "ease-out",
                [
                    0.160572462943,
                    0.378138556178,
                    0.684642745779,
                    0.906535359055,
                    0.982973587622,
                ],
            ),
            (
                "ease-in-out",
                [
                    0.019722357079,
                    0.129161506299,
                    0.499999284744,
                    0.870838493701,
                    0.980277642921,
                ],
            ),
        ];
        for (easing, expected) in fixtures {
            for (t, expected) in [0.1, 0.25, 0.5, 0.75, 0.9]
                .into_iter()
                .zip(expected)
            {
                assert_close(video_tier1_ease_ratio(easing, t), expected);
            }
        }
        let expression = video_tier1_bezier_ffmpeg_expression("ease-in-out", "t");
        assert_eq!(expression.matches("st(2,").count(), 20);
        assert_eq!(video_tier1_ease_ratio("ease-in", 0.0), 0.0);
        assert_eq!(video_tier1_ease_ratio("ease-out", 1.0), 1.0);
        assert!(expression.starts_with("if(lte((t),0),0"));
    }

    #[test]
    fn video_tier1_xfade_offset_parity_fixture_is_four_seconds() {
        assert_eq!(video_tier1_xfade_offset_ms(5_000, 1_000), 4_000);
        assert_eq!(video_ffmpeg_seconds(4_000), "4.000000");
    }

    #[test]
    fn video_tier1_pipe_parse_serialize_parse_preserves_every_new_field() {
        let raw = r##"#diffforge-video 1
project "Tier One" 1920x1080
track video "V1" transition=c1:wipe-left:1000
c media/assets/a.mp4 at=0 dur=5000 kfo=0:0:ei,1000:0.5:eo,2000:1:eio fx="{\"exposure\":1.25,\"contrast\":1.4,\"saturation\":1.8,\"temperature\":35,\"curves\":\"vintage\",\"lut\":\"media/luts/look.cube\",\"chromaKey\":{\"color\":\"#00ff00\",\"similarity\":0.25,\"blend\":0.15},\"blur\":2.5,\"vignette\":0.6,\"grain\":0.4,\"blend\":\"screen\"}" crop=0.1:0.2:0.15:0.05
c media/assets/b.mp4 at=5000 dur=5000
track text "Captions"
t "hello world" at=0 dur=2000 words="[{\"text\":\"hello\",\"startMs\":0,\"endMs\":700},{\"text\":\"world\",\"startMs\":800,\"endMs\":1500}]" anim=word-highlight animOpts="{\"highlightColor\":\"#ff0000\"}"
"##;
        let first = video_pipe_parse_project(raw).expect("parse tier1 pipe");
        let serialized = video_pipe_serialize_project(&first).expect("serialize tier1 pipe");
        let second = video_pipe_parse_project(&serialized).expect("reparse tier1 pipe");
        assert_eq!(first, second, "{serialized}");
        assert!(serialized.contains("transition=c1:wipe-left:1000"));
        assert!(serialized.contains(":ei"));
        assert!(serialized.contains(":eo"));
        assert!(serialized.contains(":eio"));
        assert!(serialized.contains(" fx="));
        assert!(serialized.contains(" crop=0.1:0.2:0.15:0.05"));
        assert!(serialized.contains(" words="));
        assert!(serialized.contains(" anim=word-highlight"));
        assert!(serialized.contains(" animOpts="));
    }

    fn media_clip() -> VideoExportMediaClip {
        VideoExportMediaClip {
            clip_id: "c1".to_string(),
            link_id: String::new(),
            track_id: "v1".to_string(),
            track_order: 1,
            input_index: 0,
            kind: "video".to_string(),
            abs_path: std::path::PathBuf::from("media/assets/a.mp4"),
            timeline_start_ms: 0,
            duration_ms: 5_000,
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
            fx: VideoTier1Fx::default(),
            crop: VideoTier1Crop::default(),
            lut_abs: None,
            supports_colortemperature: false,
            transition_after: None,
            has_audio: false,
        }
    }

    #[test]
    fn video_tier1_fx_and_crop_filter_order_matches_contract() {
        let mut clip = media_clip();
        clip.fx = VideoTier1Fx {
            exposure: 1.0,
            contrast: 1.2,
            saturation: 1.3,
            temperature: 20.0,
            curves: "strong_contrast".to_string(),
            lut: "media/luts/look.cube".to_string(),
            chroma_key: Some(VideoTier1ChromaKey::default()),
            blur: 3.0,
            vignette: 0.5,
            grain: 0.5,
            blend: "multiply".to_string(),
        };
        clip.crop = VideoTier1Crop {
            l: 0.1,
            t: 0.1,
            r: 0.1,
            b: 0.1,
        };
        clip.lut_abs = Some(std::path::PathBuf::from("/tmp/look.cube"));
        let chain = video_tier1_visual_source_chain(&clip, true, 1920, 1080, 30.0, 0, 0);
        let ordered = [
            "chromakey=",
            "eq=",
            "colorbalance=",
            "curves=",
            "lut3d=",
            "gblur=",
            "vignette=",
            "noise=",
            "crop=",
            "scale=",
        ];
        let mut previous = 0;
        for needle in ordered {
            let position = chain.find(needle).unwrap_or_else(|| panic!("{needle}: {chain}"));
            assert!(position >= previous, "{needle} out of order: {chain}");
            previous = position;
        }
        assert!(chain.contains("crop=w=iw*(1-0.100000-0.100000)"));
    }

    #[test]
    fn video_tier1_transition_graph_contains_xfade_and_acrossfade() {
        let mut left = media_clip();
        left.has_audio = true;
        left.scale = 0.5;
        left.fx.blend = "overlay".to_string();
        left.scale_keyframes = vec![
            VideoExportPropertyKeyframe {
                at_ms: 0,
                value: 0.5,
                easing: "ease-in-out".to_string(),
            },
            VideoExportPropertyKeyframe {
                at_ms: 5_000,
                value: 1.0,
                easing: "linear".to_string(),
            },
        ];
        left.transition_after = Some(VideoExportTransition {
            id: "tr1".to_string(),
            after_clip_id: "c1".to_string(),
            kind: "crossfade".to_string(),
            duration_ms: 1_000,
        });
        let mut right = media_clip();
        right.clip_id = "c2".to_string();
        right.input_index = 1;
        right.timeline_start_ms = 5_000;
        right.has_audio = true;
        right.scale = 0.5;
        right.fx.blend = "overlay".to_string();
        let (filter, _, _) = video_build_export_filter(
            &serde_json::json!({"settings":{"background":"#000000"}}),
            &[left, right],
            &[],
            10_000,
            1920,
            1080,
            30.0,
            true,
        );
        assert!(filter.contains("xfade=transition=fade:duration=1.000000:offset=4.500000"), "{filter}");
        assert!(filter.contains("acrossfade=d=1.000000"), "{filter}");
    }

    #[test]
    fn video_tier1_transition_graph_is_accepted_by_available_ffmpeg() {
        if std::process::Command::new("ffmpeg")
            .args(["-hide_banner", "-version"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|status| !status.success())
            .unwrap_or(true)
        {
            return;
        }
        let mut left = media_clip();
        left.has_audio = true;
        left.scale = 0.5;
        left.fx.blend = "overlay".to_string();
        left.scale_keyframes = vec![
            VideoExportPropertyKeyframe {
                at_ms: 0,
                value: 0.5,
                easing: "ease-in-out".to_string(),
            },
            VideoExportPropertyKeyframe {
                at_ms: 5_000,
                value: 1.0,
                easing: "linear".to_string(),
            },
        ];
        left.transition_after = Some(VideoExportTransition {
            id: "tr1".to_string(),
            after_clip_id: "c1".to_string(),
            kind: "crossfade".to_string(),
            duration_ms: 1_000,
        });
        let mut right = media_clip();
        right.clip_id = "c2".to_string();
        right.input_index = 1;
        right.timeline_start_ms = 5_000;
        right.has_audio = true;
        right.scale = 0.5;
        right.fx.blend = "overlay".to_string();
        let (filter, video_output, audio_output) = video_build_export_filter(
            &serde_json::json!({"settings":{"background":"#000000"}}),
            &[left, right],
            &[],
            10_000,
            320,
            180,
            30.0,
            true,
        );
        let input_a = "testsrc2=size=320x180:rate=30:duration=5[out0];sine=frequency=440:duration=5[out1]";
        // Deliberately mix source rates: the shared source chain must normalize
        // both sides to the project FPS before xfade.
        let input_b = "testsrc2=size=320x180:rate=24:duration=5[out0];sine=frequency=880:duration=5[out1]";
        let video_map = format!("[{video_output}]");
        let audio_map = format!("[{audio_output}]");
        let output = std::process::Command::new("ffmpeg")
            .args([
                "-nostdin",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                input_a,
                "-f",
                "lavfi",
                "-i",
                input_b,
                "-filter_complex",
                &filter,
                "-map",
                &video_map,
                "-map",
                &audio_map,
                "-t",
                "0.2",
                "-f",
                "null",
                "-",
            ])
            .output()
            .expect("run ffmpeg graph validation");
        assert!(
            output.status.success(),
            "{}\n{filter}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(filter.contains("blend=all_mode=overlay:c3_expr=A"));
    }

    #[test]
    fn video_tier1_transition_render_probe_preserves_absolute_timing_audio_and_duration() {
        if !video_test_tool_available("ffmpeg") || !video_test_tool_available("ffprobe") {
            return;
        }
        let root = std::env::temp_dir().join(format!(
            "diffforge-transition-probe-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).expect("create probe directory");
        let a_video = root.join("a.mp4");
        let b_video = root.join("b.mp4");
        let a_audio = root.join("a.wav");
        let b_audio = root.join("b.wav");
        video_test_run(
            std::process::Command::new("ffmpeg")
                .args(["-v", "error", "-f", "lavfi", "-i", "color=red:s=96x54:r=30:d=5.5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y"])
                .arg(&a_video),
            "create A video",
        );
        video_test_run(
            std::process::Command::new("ffmpeg")
                .args(["-v", "error", "-f", "lavfi", "-i", "color=green:s=96x54:r=30:d=1.5", "-f", "lavfi", "-i", "color=blue:s=96x54:r=30:d=4", "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y"])
                .arg(&b_video),
            "create B marker video",
        );
        video_test_run(
            std::process::Command::new("ffmpeg")
                .args(["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=5.5", "-af", "pan=stereo|c0=c0|c1=0*c0", "-c:a", "pcm_s16le", "-y"])
                .arg(&a_audio),
            "create left-channel audio",
        );
        video_test_run(
            std::process::Command::new("ffmpeg")
                .args(["-v", "error", "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000:duration=5.5", "-af", "pan=stereo|c0=0*c0|c1=c0", "-c:a", "pcm_s16le", "-y"])
                .arg(&b_audio),
            "create right-channel audio",
        );

        let mut left = media_clip();
        left.track_order = 0;
        left.abs_path = a_video;
        left.link_id = "link-a".to_string();
        left.transition_after = Some(VideoExportTransition {
            id: "tr1".to_string(),
            after_clip_id: left.clip_id.clone(),
            kind: "crossfade".to_string(),
            duration_ms: 1_000,
        });
        let mut right = media_clip();
        right.clip_id = "c2".to_string();
        right.input_index = 1;
        right.track_order = 0;
        right.abs_path = b_video;
        right.timeline_start_ms = 5_000;
        right.source_in_ms = 500;
        right.link_id = "link-b".to_string();
        let mut left_audio = media_clip();
        left_audio.clip_id = "a1".to_string();
        left_audio.link_id = "link-a".to_string();
        left_audio.track_id = "a1".to_string();
        left_audio.track_order = 1;
        left_audio.input_index = 2;
        left_audio.kind = "audio".to_string();
        left_audio.abs_path = a_audio;
        left_audio.has_audio = true;
        let mut right_audio = left_audio.clone();
        right_audio.clip_id = "a2".to_string();
        right_audio.link_id = "link-b".to_string();
        right_audio.input_index = 3;
        right_audio.abs_path = b_audio;
        right_audio.timeline_start_ms = 5_000;
        right_audio.source_in_ms = 500;
        let clips = vec![left, right, left_audio, right_audio];
        let (filter, video_output, audio_output) = video_build_export_filter(
            &serde_json::json!({"settings":{"background":"#000000"}}),
            &clips,
            &[],
            10_000,
            96,
            54,
            30.0,
            true,
        );
        assert!(filter.contains("xfade=transition=fade:duration=1.000000:offset=4.500000"));
        assert!(filter.contains("acrossfade=d=1.000000"));
        let caption = VideoExportTextClip {
            text: "ON TIME".to_string(),
            timeline_start_ms: 7_000,
            duration_ms: 1_000,
            font_size: 20.0,
            color: "#ffffff".to_string(),
            background: None,
            outline_color: "#000000".to_string(),
            outline_width: 0.0,
            shadow: false,
            uppercase: false,
            align: "center".to_string(),
            bold: false,
            font_family: "sans-serif".to_string(),
            x: 0.5,
            y: 0.5,
            words: Vec::new(),
            anim: "none".to_string(),
            anim_opts: VideoTier1AnimOpts::default(),
            word_time_offset_ms: 0,
        };
        let (caption_filter, _, _) = video_build_export_filter(
            &serde_json::json!({"settings":{"background":"#000000"}}),
            &clips,
            &[caption],
            10_000,
            96,
            54,
            30.0,
            false,
        );
        assert!(caption_filter.contains("between(t,7.000000,8.000000)"));
        let output_path = root.join("probe.mkv");
        let mut command = std::process::Command::new("ffmpeg");
        command.args(["-nostdin", "-v", "error"]);
        for clip in &clips {
            command.arg("-i").arg(&clip.abs_path);
        }
        command
            .args(["-filter_complex", &filter, "-map"])
            .arg(format!("[{video_output}]"))
            .arg("-map")
            .arg(format!("[{audio_output}]"))
            .args(["-t", "10", "-c:v", "ffv1", "-c:a", "pcm_s16le", "-y"])
            .arg(&output_path);
        video_test_run(&mut command, "render transition acceptance probe");

        let duration = video_test_probe_duration(&output_path);
        assert!((duration - 10.0).abs() <= 1.0 / 30.0, "duration={duration}");
        let at_4_25 = video_test_sample_rgb(&output_path, "4.25");
        let at_5_75 = video_test_sample_rgb(&output_path, "5.75");
        let at_6_25 = video_test_sample_rgb(&output_path, "6.25");
        let at_9_50 = video_test_sample_rgb(&output_path, "9.50");
        assert!(at_4_25[0] > 180 && at_4_25[1] < 80 && at_4_25[2] < 80, "{at_4_25:?}");
        assert!(at_5_75[1] > at_5_75[0] * 2 && at_5_75[1] > at_5_75[2], "{at_5_75:?}");
        assert!(at_6_25[2] > 150 && at_6_25[0] < 80, "{at_6_25:?}");
        assert!(at_9_50[2] > 150 && at_9_50[0] < 80, "{at_9_50:?}");
        let before = video_test_audio_rms(&output_path, "4.10");
        let during = video_test_audio_rms(&output_path, "4.90");
        let after = video_test_audio_rms(&output_path, "5.70");
        assert!(before.0 > before.1 * 8.0, "before={before:?}");
        assert!(during.0 > 100.0 && during.1 > 100.0, "during={during:?}");
        assert!(after.1 > after.0 * 8.0, "after={after:?}");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn video_tier1_image_transition_probe_preserves_duration_and_last_frame() {
        if !video_test_tool_available("ffmpeg") || !video_test_tool_available("ffprobe") {
            return;
        }
        let root = std::env::temp_dir().join(format!(
            "diffforge-image-transition-probe-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).expect("create image probe directory");
        let red = root.join("red.png");
        let blue = root.join("blue.png");
        for (color, path) in [("red", &red), ("blue", &blue)] {
            video_test_run(
                std::process::Command::new("ffmpeg")
                    .args(["-v", "error", "-f", "lavfi", "-i"])
                    .arg(format!("color={color}:s=64x64"))
                    .args(["-frames:v", "1", "-y"])
                    .arg(path),
                "create image transition fixture",
            );
        }
        let mut left = media_clip();
        left.kind = "image".to_string();
        left.abs_path = red;
        left.duration_ms = 2_000;
        left.transition_after = Some(VideoExportTransition {
            id: "image-tr".to_string(),
            after_clip_id: left.clip_id.clone(),
            kind: "crossfade".to_string(),
            duration_ms: 500,
        });
        let mut right = left.clone();
        right.clip_id = "c2".to_string();
        right.input_index = 1;
        right.abs_path = blue;
        right.timeline_start_ms = 2_000;
        right.transition_after = None;
        let clips = vec![left, right];
        let (filter, video_output, _) = video_build_export_filter(
            &serde_json::json!({"settings":{"background":"#000000"}}),
            &clips,
            &[],
            4_000,
            64,
            64,
            30.0,
            false,
        );
        let output_path = root.join("images.mkv");
        let mut command = std::process::Command::new("ffmpeg");
        command.args(["-nostdin", "-v", "error"]);
        for clip in &clips {
            let (head, tail) = video_tier1_media_transition_handles(&clips, clip.input_index);
            command
                .args(["-loop", "1", "-t"])
                .arg(video_ffmpeg_seconds(clip.duration_ms + head + tail))
                .arg("-i")
                .arg(&clip.abs_path);
        }
        command
            .args(["-filter_complex", &filter, "-map"])
            .arg(format!("[{video_output}]"))
            .args(["-t", "4", "-c:v", "ffv1", "-y"])
            .arg(&output_path);
        video_test_run(&mut command, "render image transition probe");
        let duration = video_test_probe_duration(&output_path);
        assert!((duration - 4.0).abs() <= 1.0 / 30.0, "duration={duration}");
        let last = video_test_sample_rgb(&output_path, "3.75");
        assert!(last[2] > 150 && last[0] < 80, "{last:?}");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn video_tier1_silencedetect_parser_pairs_and_closes_ranges() {
        let output = "[silencedetect] silence_start: 0.400\n[silencedetect] silence_end: 1.25 | silence_duration: 0.85\n[silencedetect] silence_start: 4.0\n";
        assert_eq!(
            video_tier1_parse_silencedetect_output(output, Some(5_000)),
            vec![
                VideoSilenceRange {
                    start_ms: 400,
                    end_ms: 1_250,
                },
                VideoSilenceRange {
                    start_ms: 4_000,
                    end_ms: 5_000,
                },
            ]
        );
    }

    #[test]
    fn video_tier1_silence_detection_and_mcp_skip_video_without_audio() {
        if !video_test_tool_available("ffmpeg") || !video_test_tool_available("ffprobe") {
            return;
        }
        let root = std::env::temp_dir().join(format!(
            "diffforge-no-audio-silence-{}",
            uuid::Uuid::new_v4()
        ));
        let media_root = root.join("media");
        std::fs::create_dir_all(media_root.join("assets")).expect("create no-audio media");
        let asset = media_root.join("assets/no-audio.mp4");
        video_test_run(
            std::process::Command::new("ffmpeg")
                .args(["-v", "error", "-f", "lavfi", "-i", "color=black:s=64x64:r=10:d=0.5", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y"])
                .arg(&asset),
            "create no-audio video",
        );
        let ranges = video_tier1_detect_silences_blocking(
            "ffmpeg",
            Some("ffprobe"),
            &asset,
            -35.0,
            100,
        )
        .expect("no-audio detection is a successful empty result");
        assert!(ranges.is_empty());
        let mut project = VideoMcpProject {
            tracks: vec![VideoMcpTrack {
                id: "v1".to_string(),
                kind: "video".to_string(),
                clips: vec![VideoMcpClip {
                    id: "c1".to_string(),
                    asset_path: "media/assets/no-audio.mp4".to_string(),
                    duration_ms: 500,
                    ..VideoMcpClip::default()
                }],
                ..VideoMcpTrack::default()
            }],
            ..VideoMcpProject::default()
        };
        let mut state = VideoMcpEditState {
            next_clip_seq: 2,
            next_link_seq: 1,
            changed_clip_ids: std::collections::BTreeSet::new(),
            effective_ranges: Vec::new(),
            summaries: Vec::new(),
        };
        video_tier1_mcp_remove_silences(
            &mut project,
            &root,
            &media_root,
            Some("ffprobe"),
            None,
            -35.0,
            100,
            &mut state,
        )
        .expect("MCP skips no-audio asset");
        assert!(state.effective_ranges.is_empty());
        assert!(state.summaries.iter().any(|summary| summary == "no silences found"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn video_tier1_hardware_encoder_selection_follows_platform_priority() {
        let names = ["h264_amf", "h264_qsv", "h264_nvenc"]
            .into_iter()
            .map(ToOwned::to_owned)
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(
            video_tier1_select_hardware_encoder("windows", &names)
                .expect("windows hardware")
                .name,
            "h264_nvenc"
        );
        let linux = ["h264_vaapi".to_string()]
            .into_iter()
            .collect::<std::collections::BTreeSet<_>>();
        assert!(video_tier1_select_hardware_encoder("linux", &linux)
            .expect("linux hardware")
            .vaapi);
        assert!(video_tier1_select_hardware_encoder("other", &names).is_none());
        assert_eq!(
            serde_json::to_value(VideoExportEncodersResponse {
                hardware_available: true,
                encoder: "h264_nvenc".to_string(),
            })
            .expect("serialize encoder probe"),
            serde_json::json!({"hardwareAvailable": true, "encoder": "h264_nvenc"})
        );
    }

    #[test]
    fn video_tier1_draft_paths_finalize_atomically_and_prune_safely() {
        let root = std::env::temp_dir().join(format!(
            "diffforge-draft-lifecycle-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).expect("create draft lifecycle directory");
        let job_id = uuid::Uuid::new_v4().to_string();
        let (final_path, partial_path) = video_tier1_draft_paths(&root, &job_id);
        assert_eq!(
            final_path.file_name().and_then(|value| value.to_str()),
            Some(format!("{job_id}.mp4").as_str())
        );
        assert!(partial_path.ends_with(format!("{job_id}.mp4.partial")));
        std::fs::write(&partial_path, b"complete draft bytes").expect("write partial draft");
        assert!(!final_path.exists());
        std::fs::rename(&partial_path, &final_path).expect("atomic draft rename");
        assert!(final_path.is_file());
        assert!(!partial_path.exists());

        let protected = root.join("protected.mp4");
        std::fs::write(&protected, b"protected").expect("write protected draft");
        video_tier1_record_completion_path(&protected);
        std::thread::sleep(std::time::Duration::from_millis(5));
        let mut newest = Vec::new();
        for index in 0..4 {
            let path = root.join(format!("new-{index}.mp4"));
            std::fs::write(&path, [index]).expect("write prune fixture");
            newest.push(path);
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        video_tier1_prune_drafts(&root);
        assert!(protected.exists(), "most recent completion path was pruned");
        assert!(newest[3].exists());
        assert!(newest[2].exists());
        assert!(newest[1].exists());
        assert!(!newest[0].exists());
        let _ = std::fs::remove_dir_all(root);
    }

    fn video_test_assert_xml_well_formed(xml: &str) {
        let mut reader = quick_xml::Reader::from_str(xml);
        reader.config_mut().trim_text(true);
        loop {
            match reader.read_event() {
                Ok(quick_xml::events::Event::Eof) => break,
                Ok(_) => {}
                Err(error) => panic!("XML is not well formed: {error}\n{xml}"),
            }
        }
    }

    fn video_test_assert_fcpx_times_frame_aligned(xml: &str) {
        let mut reader = quick_xml::Reader::from_str(xml);
        loop {
            let event = reader.read_event().expect("read FCPXML event");
            let element = match &event {
                quick_xml::events::Event::Start(element)
                | quick_xml::events::Event::Empty(element) => Some(element),
                quick_xml::events::Event::Eof => break,
                _ => None,
            };
            let Some(element) = element else {
                continue;
            };
            for attr in element.attributes().flatten() {
                let key = attr.key.as_ref();
                if !matches!(key, b"offset" | b"duration" | b"start" | b"time" | b"value") {
                    continue;
                }
                let value = String::from_utf8_lossy(attr.value.as_ref());
                if !value.ends_with('s') || value == "0s" {
                    continue;
                }
                let Some((numerator, denominator)) = value.trim_end_matches('s').split_once('/') else {
                    continue;
                };
                let numerator = numerator.parse::<u64>().expect("FCP time numerator");
                let denominator = denominator.parse::<u64>().expect("FCP time denominator");
                assert_eq!(denominator, 3000, "unaligned time {value}");
                assert_eq!(numerator % 100, 0, "unaligned time {value}");
            }
        }
    }

    fn video_test_interchange_fixture() -> (std::path::PathBuf, std::path::PathBuf, serde_json::Value) {
        let root = std::env::temp_dir().join(format!(
            "diffforge-interchange-fixture-{}",
            uuid::Uuid::new_v4()
        ));
        let media_root = root.join("media");
        std::fs::create_dir_all(media_root.join("assets")).expect("create fixture media");
        for name in ["a.mov", "b.mov", "c.mov", "audio.wav"] {
            std::fs::write(media_root.join("assets").join(name), []).expect("write fixture asset");
        }
        let project = serde_json::json!({
            "name": "Interchange Fixture",
            "settings": {"width": 1920, "height": 1080, "fps": 30.0},
            "tracks": [
                {"id":"v1","kind":"video","clips":[
                    {"id":"p1","assetPath":"media/assets/a.mov","timelineStartMs":0,"durationMs":1000,"sourceInMs":1000,"linkId":"av1","transform":{"opacity":0.8},"kf":{"opacity":[{"atMs":0,"value":1.0,"easing":"linear"},{"atMs":500,"value":0.25,"easing":"ease-out"}]}},
                    {"id":"p2","assetPath":"media/assets/b.mov","timelineStartMs":1000,"durationMs":1000,"sourceInMs":0,"speed":2.0},
                    {"id":"p3","assetPath":"media/assets/c.mov","timelineStartMs":3000,"durationMs":1000,"sourceInMs":0}
                ],"transitions":[{"id":"tr1","afterClipId":"p1","kind":"crossfade","durationMs":400}]},
                {"id":"v2","kind":"video","clips":[
                    {"id":"overlay","assetPath":"media/assets/c.mov","timelineStartMs":500,"durationMs":1200,"sourceInMs":0}
                ]},
                {"id":"titles","kind":"text","clips":[
                    {"id":"t1","text":"First","timelineStartMs":200,"durationMs":500},
                    {"id":"t2","text":"Second","timelineStartMs":2200,"durationMs":500}
                ]},
                {"id":"a1","kind":"audio","clips":[
                    {"id":"audio1","assetPath":"media/assets/audio.wav","timelineStartMs":0,"durationMs":1000,"sourceInMs":250,"linkId":"av1"}
                ]}
            ]
        });
        (root, media_root, project)
    }

    #[test]
    fn video_tier1_fcpxml_fixture_is_well_formed_and_dtd_basic_valid() {
        let (root, media_root, project) = video_test_interchange_fixture();
        let (xml, warnings) =
            video_tier1_build_fcpxml(&root, &media_root, &project).expect("build FCPXML");
        video_test_assert_xml_well_formed(&xml);
        video_test_assert_fcpx_times_frame_aligned(&xml);
        assert!(xml.contains("frameDuration=\"100/3000s\""), "{xml}");
        assert!(xml.contains("<effect id=\"rTitle\""), "{xml}");
        assert_eq!(xml.matches("<title ").count(), 2, "{xml}");
        assert_eq!(xml.matches("ref=\"rTitle\"").count(), 2, "{xml}");
        assert!(xml.contains("text-style ref=\"ts1\""), "{xml}");
        assert!(xml.contains("text-style ref=\"ts2\""), "{xml}");
        assert!(
            xml.contains("<title name=\"t1\" ref=\"rTitle\" offset=\"3600/3000s\""),
            "connected title must use the source-trimmed parent local timeline: {xml}"
        );
        assert!(
            xml.contains("<title name=\"t2\" ref=\"rTitle\" offset=\"600/3000s\""),
            "gap-connected title must use a gap-relative offset: {xml}"
        );
        assert!(
            xml.contains("name=\"audio1\" ref=\"r5\" offset=\"3000/3000s\""),
            "linked audio must be anchored in the parent clip's local timeline: {xml}"
        );
        assert!(xml.contains("<gap name=\"Gap\""), "{xml}");
        assert!(xml.contains("lane=\"2\""), "{xml}");
        assert!(xml.contains("lane=\"-1\""), "{xml}");
        assert!(xml.contains("audioRole=\"dialogue\""), "{xml}");
        assert!(xml.contains("<adjust-blend amount=\"0.800000\""), "{xml}");
        assert!(!xml.contains(" frame=\""), "{xml}");
        assert!(!xml.contains("amount=\"80"), "{xml}");
        assert!(!warnings.iter().any(|warning| warning.contains("av1") && warning.contains("unambiguously")));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn video_tier1_premiere_fixture_is_well_formed_and_dtd_basic_valid() {
        let (root, media_root, mut project) = video_test_interchange_fixture();
        project["settings"]["fps"] = serde_json::json!(30_000.0 / 1001.0);
        let overrides = [
            ("media/assets/a.mov".to_string(), 24.0),
            ("media/assets/b.mov".to_string(), 24.0),
            ("media/assets/c.mov".to_string(), 24.0),
        ]
        .into_iter()
        .collect::<std::collections::BTreeMap<_, _>>();
        let (xml, warnings) = video_tier1_build_premiere_xml(
            &root,
            &media_root,
            &project,
            None,
            Some(&overrides),
        )
        .expect("build Premiere XML");
        video_test_assert_xml_well_formed(&xml);
        assert!(xml.contains("<timebase>30</timebase><ntsc>TRUE</ntsc>"), "{xml}");
        assert!(xml.contains("<in>24</in><out>48</out>"), "{xml}");
        assert!(xml.contains("<transitionitem><name>Cross Dissolve</name>"), "{xml}");
        assert!(xml.contains("<alignment>center</alignment>"), "{xml}");
        assert!(xml.contains("<effectid>Cross Dissolve</effectid>"), "{xml}");
        assert_eq!(xml.matches("<link>").count(), 4, "{xml}");
        assert!(xml.contains("<linkclipref>v-p1</linkclipref><mediatype>video</mediatype><trackindex>1</trackindex>"), "{xml}");
        assert!(xml.contains("<linkclipref>a-audio1</linkclipref><mediatype>audio</mediatype><trackindex>1</trackindex>"), "{xml}");
        assert!(xml.contains("<clipitem id=\"a-audio1\""), "{xml}");
        assert!(xml.contains("<in>7</in><out>37</out>"), "{xml}");
        assert!(!xml.contains("<param "), "{xml}");
        assert!(warnings.iter().any(|warning| warning.contains("p2 speed is not encoded")));
        let windows = video_tier1_file_url(std::path::Path::new("C:\\Media\\clip one.mov"));
        assert_eq!(windows, "file:///C:/Media/clip%20one.mov");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn video_tier1_caption_cap_and_pop_create_human_warnings() {
        let words = (0..121)
            .map(|index| serde_json::json!({
                "text": format!("w{index}"),
                "startMs": index * 10,
                "endMs": index * 10 + 8,
            }))
            .collect::<Vec<_>>();
        let project = serde_json::json!({
            "settings": {"width": 1920, "height": 1080},
            "tracks": [{
                "id": "t1", "kind": "text", "clips": [
                    {"id":"c1","text":"many","timelineStartMs":0,"durationMs":2000,"words":words,"anim":"typewriter"},
                    {"id":"c2","text":"pop","timelineStartMs":2000,"durationMs":1000,"anim":"pop"}
                ]
            }]
        });
        let root = std::env::temp_dir().join(format!("video-tier1-{}", uuid::Uuid::new_v4()));
        let media_root = root.join("media");
        std::fs::create_dir_all(&media_root).expect("media root");
        let (_, text_clips, _, warnings) = video_collect_export_clips(
            &root,
            &media_root,
            &project,
            None,
            None,
        )
        .expect("collect text clips");
        assert!(warnings.iter().any(|warning| warning.contains("120 words")));
        assert!(warnings.iter().any(|warning| warning.contains("approximated")));
        let (filter, _, _) = video_build_export_filter(
            &project,
            &[],
            &text_clips,
            3_000,
            1920,
            1080,
            30.0,
            false,
        );
        assert!(
            filter.contains("(t-2)/0.25"),
            "pop without word timings must still use the fade approximation: {filter}"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn video_tier1_bottom_layer_chroma_key_emits_export_warning() {
        let root = std::env::temp_dir().join(format!(
            "diffforge-bottom-chroma-{}",
            uuid::Uuid::new_v4()
        ));
        let media_root = root.join("media");
        std::fs::create_dir_all(media_root.join("assets")).expect("create chroma fixture");
        let project = serde_json::json!({
            "settings":{"width":320,"height":180,"fps":30},
            "tracks":[{"id":"v1","kind":"video","clips":[{
                "id":"green","assetPath":"media/assets/green.mp4","timelineStartMs":0,"durationMs":1000,
                "fx":{"chromaKey":{"color":"#00ff00","similarity":0.2,"blend":0.1}}
            }]}]
        });
        let (_, _, _, warnings) =
            video_collect_export_clips(&root, &media_root, &project, None, None)
                .expect("collect bottom chroma clip");
        assert!(warnings.iter().any(|warning| {
            warning.contains("green") && warning.contains("ignored on the bottom video layer")
        }));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn video_tier1_collect_export_accepts_adjacent_image_transition() {
        let root = std::env::temp_dir().join(format!(
            "diffforge-image-transition-collect-{}",
            uuid::Uuid::new_v4()
        ));
        let media_root = root.join("media");
        std::fs::create_dir_all(media_root.join("assets")).expect("create image collect fixture");
        let project = serde_json::json!({
            "settings":{"width":320,"height":180,"fps":30},
            "tracks":[{"id":"v1","kind":"video","clips":[
                {"id":"i1","assetPath":"media/assets/one.png","timelineStartMs":0,"durationMs":1000},
                {"id":"i2","assetPath":"media/assets/two.png","timelineStartMs":1000,"durationMs":1000}
            ],"transitions":[{"id":"tr1","afterClipId":"i1","kind":"crossfade","durationMs":400}]}]
        });
        let (clips, _, _, warnings) =
            video_collect_export_clips(&root, &media_root, &project, None, None)
                .expect("collect image transition");
        assert_eq!(clips.len(), 2);
        assert!(clips[0].transition_after.is_some(), "{warnings:?}");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn video_tier1_range_revalidates_transition_duration_after_clipping() {
        let mut left = media_clip();
        left.transition_after = Some(VideoExportTransition {
            id: "tr1".to_string(),
            after_clip_id: "c1".to_string(),
            kind: "crossfade".to_string(),
            duration_ms: 1_000,
        });
        let mut right = media_clip();
        right.clip_id = "c2".to_string();
        right.input_index = 1;
        right.timeline_start_ms = 5_000;
        let (clips, _, _) =
            video_export_window_clips_for_range(&[left.clone(), right.clone()], &[], 4_500, 5_500)
                .expect("window transition");
        assert_eq!(clips.len(), 2);
        assert_eq!(
            clips[0]
                .transition_after
                .as_ref()
                .expect("clamped transition")
                .duration_ms,
            250
        );

        let (clips, _, _) =
            video_export_window_clips_for_range(&[left, right], &[], 4_900, 5_100)
                .expect("narrow transition window");
        assert!(clips[0].transition_after.is_none());
    }

    #[test]
    fn video_tier1_worker_range_plan_decodes_only_windowed_clips_and_progress_duration() {
        let mut left = media_clip();
        left.transition_after = Some(VideoExportTransition {
            id: "tr1".to_string(),
            after_clip_id: "c1".to_string(),
            kind: "crossfade".to_string(),
            duration_ms: 1_000,
        });
        let mut right = media_clip();
        right.clip_id = "c2".to_string();
        right.input_index = 1;
        right.timeline_start_ms = 5_000;
        let mut off_range = media_clip();
        off_range.clip_id = "off".to_string();
        off_range.input_index = 2;
        off_range.timeline_start_ms = 20_000;
        let (clips, text, total_ms) = video_export_plan_worker_clips(
            vec![left, right, off_range],
            Vec::new(),
            25_000,
            Some((4_500, 5_500)),
        )
        .expect("plan worker range");
        assert_eq!(total_ms, 1_000);
        assert!(text.is_empty());
        assert_eq!(clips.len(), 2);
        assert_eq!(clips[0].input_index, 0);
        assert_eq!(clips[1].input_index, 1);
        assert_eq!(clips[0].source_in_ms, 4_500);
        assert_eq!(clips[0].duration_ms, 500);
        assert_eq!(clips[1].timeline_start_ms, 500);
        assert_eq!(
            clips[0]
                .transition_after
                .as_ref()
                .expect("range transition")
                .duration_ms,
            250
        );
        let (filter, video_output, audio_output) = video_build_export_filter(
            &serde_json::json!({"settings":{"background":"#000000"}}),
            &clips,
            &[],
            total_ms,
            320,
            180,
            30.0,
            true,
        );
        assert!(!filter.contains("vrange"));
        let args = video_tier1_export_ffmpeg_args(
            &clips,
            &filter,
            &video_output,
            &audio_output,
            "mp4",
            23,
            "medium",
            30.0,
            total_ms,
            std::path::Path::new("/tmp/range.mp4"),
            None,
        );
        assert!(args.windows(2).any(|pair| pair == ["-t", "1.000000"]));
        // The windowed plan keeps the 250ms transition. With the handle-consuming
        // construction each side is tpad-extended by d/2 (0.125s), so the xfade
        // offset on the EXTENDED pair is 0.625 - 0.25 = 0.375s (window-relative).
        // An un-rebased absolute-timeline leak would show ~4.875s instead.
        assert!(filter.contains("offset=0.375000"), "{filter}");
        assert!(!filter.contains("offset=4.875000"), "{filter}");
        // Source decode must be rebased into the window (4.5s into the asset).
        assert!(filter.contains("trim=start=4.500000"), "{filter}");
    }

    #[test]
    fn video_tier1_mcp_transition_ops_add_remove_and_normalize() {
        let mut project = VideoMcpProject {
            tracks: vec![VideoMcpTrack {
                id: "v1".to_string(),
                kind: "video".to_string(),
                clips: vec![
                    VideoMcpClip {
                        id: "c1".to_string(),
                        asset_path: "media/assets/a.mp4".to_string(),
                        duration_ms: 5_000,
                        ..VideoMcpClip::default()
                    },
                    VideoMcpClip {
                        id: "c2".to_string(),
                        asset_path: "media/assets/b.mp4".to_string(),
                        timeline_start_ms: 5_000,
                        duration_ms: 5_000,
                        ..VideoMcpClip::default()
                    },
                ],
                ..VideoMcpTrack::default()
            }],
            ..VideoMcpProject::default()
        };
        let mut state = VideoMcpEditState {
            next_clip_seq: 3,
            next_link_seq: 1,
            changed_clip_ids: std::collections::BTreeSet::new(),
            effective_ranges: Vec::new(),
            summaries: Vec::new(),
        };
        video_tier1_mcp_add_transition(
            &mut project,
            "v1",
            "c1",
            "crossfade",
            1_000,
            &mut state,
        )
        .expect("add transition");
        assert_eq!(project.tracks[0].transitions.len(), 1);
        let transition_id = project.tracks[0].transitions[0].id.clone();
        project.tracks[0].clips[1].timeline_start_ms = 5_001;
        video_tier1_normalize_mcp_transitions(&mut project);
        assert!(project.tracks[0].transitions.is_empty());
        project.tracks[0].clips[1].timeline_start_ms = 5_000;
        video_tier1_mcp_add_transition(
            &mut project,
            "v1",
            "c1",
            "wipe-left",
            900,
            &mut state,
        )
        .expect("re-add transition");
        let remove_id = project.tracks[0].transitions[0].id.clone();
        video_tier1_mcp_remove_transition(&mut project, &remove_id, &mut state)
        .expect("remove transition");
        assert!(project.tracks[0].transitions.is_empty());
        assert_eq!(transition_id, "tr1");
    }

    #[test]
    fn video_tier1_transition_normalization_clamps_then_drops_and_is_video_only() {
        let transition = VideoExportTransition {
            id: "tr1".to_string(),
            after_clip_id: "c1".to_string(),
            kind: "crossfade".to_string(),
            duration_ms: 1_000,
        };
        let clips = vec![
            VideoMcpClip {
                id: "c1".to_string(),
                asset_path: "media/assets/a.mp4".to_string(),
                duration_ms: 500,
                ..VideoMcpClip::default()
            },
            VideoMcpClip {
                id: "c2".to_string(),
                asset_path: "media/assets/b.mp4".to_string(),
                timeline_start_ms: 500,
                duration_ms: 500,
                ..VideoMcpClip::default()
            },
        ];
        let mut project = VideoMcpProject {
            tracks: vec![
                VideoMcpTrack {
                    id: "v1".to_string(),
                    kind: "video".to_string(),
                    clips: clips.clone(),
                    transitions: vec![transition.clone()],
                    ..VideoMcpTrack::default()
                },
                VideoMcpTrack {
                    id: "a1".to_string(),
                    kind: "audio".to_string(),
                    clips,
                    transitions: vec![transition],
                    ..VideoMcpTrack::default()
                },
            ],
            ..VideoMcpProject::default()
        };
        video_tier1_normalize_mcp_transitions(&mut project);
        assert_eq!(project.tracks[0].transitions[0].duration_ms, 250);
        assert!(project.tracks[1].transitions.is_empty());
        project.tracks[0].clips[0].duration_ms = 150;
        project.tracks[0].clips[1].timeline_start_ms = 150;
        project.tracks[0].clips[1].duration_ms = 150;
        video_tier1_normalize_mcp_transitions(&mut project);
        assert!(project.tracks[0].transitions.is_empty());
    }

    #[test]
    fn video_tier1_mcp_split_retargets_transition_to_right_fragment() {
        let mut project = VideoMcpProject {
            tracks: vec![VideoMcpTrack {
                id: "v1".to_string(),
                kind: "video".to_string(),
                clips: vec![
                    VideoMcpClip {
                        id: "c1".to_string(),
                        asset_path: "media/assets/a.mp4".to_string(),
                        duration_ms: 5_000,
                        ..VideoMcpClip::default()
                    },
                    VideoMcpClip {
                        id: "c2".to_string(),
                        asset_path: "media/assets/b.mp4".to_string(),
                        timeline_start_ms: 5_000,
                        duration_ms: 5_000,
                        ..VideoMcpClip::default()
                    },
                ],
                transitions: vec![VideoExportTransition {
                    id: "tr1".to_string(),
                    after_clip_id: "c1".to_string(),
                    kind: "wipe-left".to_string(),
                    duration_ms: 500,
                }],
                ..VideoMcpTrack::default()
            }],
            ..VideoMcpProject::default()
        };
        let mut state = VideoMcpEditState {
            next_clip_seq: 3,
            next_link_seq: 1,
            changed_clip_ids: std::collections::BTreeSet::new(),
            effective_ranges: Vec::new(),
            summaries: Vec::new(),
        };
        video_mcp_split(&mut project, "c1", 2_500, &mut state).expect("split clip");
        assert_eq!(project.tracks[0].transitions[0].after_clip_id, "c3");
        video_tier1_normalize_mcp_transitions(&mut project);
        assert_eq!(project.tracks[0].transitions[0].after_clip_id, "c3");
        assert_eq!(project.tracks[0].transitions[0].kind, "wipe-left");
    }

    #[test]
    fn video_tier1_mcp_set_props_merges_clears_and_normalizes_caption_fields() {
        let mut fx = VideoTier1Fx::default();
        fx.exposure = 1.0;
        fx.contrast = 1.5;
        let mut project = VideoMcpProject {
            tracks: vec![
                VideoMcpTrack {
                    id: "v1".to_string(),
                    kind: "video".to_string(),
                    clips: vec![VideoMcpClip {
                        id: "vclip".to_string(),
                        asset_path: "media/assets/a.mp4".to_string(),
                        duration_ms: 2_000,
                        fx,
                        crop: VideoTier1Crop {
                            l: 0.1,
                            ..VideoTier1Crop::default()
                        },
                        ..VideoMcpClip::default()
                    }],
                    ..VideoMcpTrack::default()
                },
                VideoMcpTrack {
                    id: "t1".to_string(),
                    kind: "text".to_string(),
                    clips: vec![VideoMcpClip {
                        id: "text".to_string(),
                        text: "caption".to_string(),
                        duration_ms: 1_000,
                        anim: "word-highlight".to_string(),
                        anim_opts: Some(VideoTier1AnimOpts {
                            highlight_color: "#ff0000".to_string(),
                        }),
                        ..VideoMcpClip::default()
                    }],
                    ..VideoMcpTrack::default()
                },
            ],
            ..VideoMcpProject::default()
        };
        let mut state = VideoMcpEditState {
            next_clip_seq: 3,
            next_link_seq: 1,
            changed_clip_ids: std::collections::BTreeSet::new(),
            effective_ranges: Vec::new(),
            summaries: Vec::new(),
        };
        video_mcp_set_props(
            &mut project,
            std::path::Path::new("/tmp"),
            std::path::Path::new("/tmp/media"),
            None,
            "vclip",
            &serde_json::json!({"fx":{"saturation":2.0},"crop":{"t":0.2}}),
            &mut state,
        )
        .expect("merge fx/crop");
        let clip = &project.tracks[0].clips[0];
        assert_eq!(clip.fx.exposure, 1.0);
        assert_eq!(clip.fx.contrast, 1.5);
        assert_eq!(clip.fx.saturation, 2.0);
        assert_eq!(clip.crop.l, 0.1);
        assert_eq!(clip.crop.t, 0.2);
        video_mcp_set_props(
            &mut project,
            std::path::Path::new("/tmp"),
            std::path::Path::new("/tmp/media"),
            None,
            "vclip",
            &serde_json::json!({"fx":null,"crop":null}),
            &mut state,
        )
        .expect("clear fx/crop");
        assert_eq!(project.tracks[0].clips[0].fx, VideoTier1Fx::default());
        assert_eq!(project.tracks[0].clips[0].crop, VideoTier1Crop::default());
        video_mcp_set_props(
            &mut project,
            std::path::Path::new("/tmp"),
            std::path::Path::new("/tmp/media"),
            None,
            "text",
            &serde_json::json!({
                "words":[
                    {"text":"late","startMs":700,"endMs":1500},
                    {"text":"early","startMs":100,"endMs":300},
                    {"text":"bad","startMs":400,"endMs":400},
                    {"text":"outside","startMs":1000,"endMs":1100},
                    {"text":"   ","startMs":0,"endMs":50}
                ],
                "anim":"fade",
                "animOpts":{"highlightColor":"#00ff00"}
            }),
            &mut state,
        )
        .expect("normalize caption props");
        let text = &project.tracks[1].clips[0];
        assert_eq!(
            text.words,
            vec![
                VideoTier1Word {
                    text: "early".to_string(),
                    start_ms: 100,
                    end_ms: 300,
                },
                VideoTier1Word {
                    text: "late".to_string(),
                    start_ms: 700,
                    end_ms: 1_000,
                }
            ]
        );
        assert_eq!(text.anim, "fade");
        assert!(text.anim_opts.is_none());
        let serialized = serde_json::to_value(text).expect("serialize text clip");
        assert!(serialized.get("animOpts").is_none());
    }
}

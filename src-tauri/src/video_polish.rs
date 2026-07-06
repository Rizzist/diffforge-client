// Diff Forge Video Editor — "polish" pipeline: cut a source video/audio down
// to a set of keep ranges (multi-take cleanup driven by the transcript) and
// splice the kept pieces into a new generated asset. The source transcript is
// remapped onto the polished timeline and written as the output's own
// transcript, so captions/word edits stay accurate on the cut.
//
// include!-style module (see lib.rs): shares one crate-root scope with
// video_editor.rs — fully-qualified paths, no top-level use statements.

const VIDEO_POLISH_PROGRESS_EVENT: &str = "video-polish-progress";
const VIDEO_POLISH_MIN_RANGE_MS: u64 = 40;
const VIDEO_POLISH_MERGE_GAP_MS: u64 = 80;

static VIDEO_POLISH_JOBS: std::sync::OnceLock<
    std::sync::Mutex<std::collections::HashMap<String, VideoJobHandle>>,
> = std::sync::OnceLock::new();

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct VideoPolishRangeInput {
    start_ms: u64,
    end_ms: u64,
}

#[allow(clippy::too_many_arguments)]
fn video_polish_emit(
    app: &tauri::AppHandle,
    repo_display: &str,
    job_id: &str,
    source_path: &str,
    state: &str,
    percent: Option<f64>,
    message: &str,
    done: bool,
    error: Option<&str>,
    output_path: Option<&str>,
) {
    let _ = app.emit(
        VIDEO_POLISH_PROGRESS_EVENT,
        serde_json::json!({
            "jobId": job_id,
            "repoPath": repo_display,
            "path": source_path,
            "state": state,
            "percent": percent,
            "message": message,
            "done": done,
            "error": error,
            "outputPath": output_path,
        }),
    );
}

/// Sorts, clamps, drops degenerate ranges, and merges overlaps/micro-gaps.
fn video_polish_normalize_ranges(
    ranges: &[VideoPolishRangeInput],
    duration_ms: Option<u64>,
) -> Result<Vec<(u64, u64)>, String> {
    let mut cleaned: Vec<(u64, u64)> = ranges
        .iter()
        .map(|range| {
            let end = duration_ms
                .map(|duration| range.end_ms.min(duration))
                .unwrap_or(range.end_ms);
            (range.start_ms, end)
        })
        .filter(|(start, end)| end.saturating_sub(*start) >= VIDEO_POLISH_MIN_RANGE_MS)
        .collect();
    cleaned.sort_by_key(|(start, _)| *start);
    let mut merged: Vec<(u64, u64)> = Vec::with_capacity(cleaned.len());
    for (start, end) in cleaned {
        match merged.last_mut() {
            Some((_, last_end)) if start <= last_end.saturating_add(VIDEO_POLISH_MERGE_GAP_MS) => {
                *last_end = (*last_end).max(end);
            }
            _ => merged.push((start, end)),
        }
    }
    if merged.is_empty() {
        return Err("Polish needs at least one keep range longer than 40ms.".to_string());
    }
    Ok(merged)
}

/// Remaps a source-timeline transcript onto the polished (concatenated keep
/// ranges) timeline. Segments crossing a cut are clipped per keep range; when
/// the source has word timings the piece text is rebuilt from its words,
/// otherwise the whole text rides on the piece with the largest overlap.
fn video_polish_remap_transcript(
    cache: &VideoTranscriptCache,
    ranges: &[(u64, u64)],
) -> VideoTranscriptCache {
    let mut prefix = Vec::with_capacity(ranges.len());
    let mut acc = 0u64;
    for (start, end) in ranges {
        prefix.push(acc);
        acc = acc.saturating_add(end.saturating_sub(*start));
    }
    let mut segments: Vec<VideoTranscriptSegment> = Vec::new();
    for segment in &cache.segments {
        let overlaps: Vec<(usize, u64, u64)> = ranges
            .iter()
            .enumerate()
            .filter_map(|(index, (start, end))| {
                let overlap_start = segment.start_ms.max(*start);
                let overlap_end = segment.end_ms.min(*end);
                (overlap_end > overlap_start).then_some((index, overlap_start, overlap_end))
            })
            .collect();
        if overlaps.is_empty() {
            continue;
        }
        let best_overlap = overlaps
            .iter()
            .enumerate()
            .max_by_key(|(_, (_, from, to))| to - from)
            .map(|(position, _)| position)
            .unwrap_or(0);
        for (position, (range_index, overlap_start, overlap_end)) in overlaps.iter().enumerate() {
            let (range_start, range_end) = ranges[*range_index];
            let offset = prefix[*range_index];
            let words: Vec<VideoTranscriptWord> = segment
                .words
                .iter()
                .filter(|word| {
                    let mid = word.start_ms / 2 + word.end_ms / 2;
                    mid >= range_start && mid <= range_end
                })
                .map(|word| VideoTranscriptWord {
                    start_ms: offset + word.start_ms.clamp(range_start, range_end) - range_start,
                    end_ms: offset + word.end_ms.clamp(range_start, range_end) - range_start,
                    text: word.text.clone(),
                })
                .collect();
            let text = if segment.words.is_empty() {
                if position == best_overlap {
                    segment.text.clone()
                } else {
                    String::new()
                }
            } else {
                words
                    .iter()
                    .map(|word| word.text.as_str())
                    .collect::<Vec<_>>()
                    .join(" ")
            };
            if text.trim().is_empty() && words.is_empty() {
                continue;
            }
            segments.push(VideoTranscriptSegment {
                start_ms: offset + overlap_start - range_start,
                end_ms: offset + overlap_end - range_start,
                text,
                words,
            });
        }
    }
    segments.sort_by_key(|segment| segment.start_ms);
    let text = segments
        .iter()
        .map(|segment| segment.text.trim())
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    VideoTranscriptCache {
        language: cache.language.clone(),
        text,
        segments,
    }
}

fn video_polish_plan_output(
    root: &std::path::Path,
    media_root: &std::path::Path,
    source_rel: &str,
    kind: &str,
) -> Result<(std::path::PathBuf, String), String> {
    let stem = std::path::Path::new(source_rel)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("clip");
    let slug = video_slugify_with_fallback(stem, "clip");
    let extension = if kind == "audio" { "m4a" } else { "mp4" };
    let dir = media_root.join(VIDEO_GENERATED_DIR);
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("Unable to create media/generated directory: {error}"))?;
    let mut candidate = dir.join(format!("{slug}-polished.{extension}"));
    let mut attempt = 1u32;
    while candidate.exists() {
        attempt += 1;
        candidate = dir.join(format!("{slug}-polished-{attempt}.{extension}"));
    }
    let rel = video_relative_path(root, &candidate);
    Ok((candidate, rel))
}

fn video_polish_between_expression(ranges: &[(u64, u64)]) -> String {
    ranges
        .iter()
        .map(|(start, end)| {
            format!(
                "between(t,{},{})",
                video_ffmpeg_seconds(*start),
                video_ffmpeg_seconds(*end)
            )
        })
        .collect::<Vec<_>>()
        .join("+")
}

#[allow(clippy::too_many_arguments)]
fn video_polish_render_blocking(
    app: tauri::AppHandle,
    job_id: String,
    repo_path: String,
    path: String,
    keep_ranges: Vec<VideoPolishRangeInput>,
    cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
) -> Result<(), String> {
    let (root, media_root) = video_workspace_media_root(repo_path.as_str())?;
    video_ensure_media_dirs(&media_root)?;
    let repo_display = root.to_string_lossy().to_string();
    let (source_abs, source_rel, kind, source_metadata) =
        video_resolve_existing_media_file(&root, &media_root, &path)?;
    if !matches!(kind, "video" | "audio") {
        return Err("Polish only applies to video or audio assets.".to_string());
    }
    let tools = video_tools_status_for(&app);
    let ffmpeg_path = tools
        .ffmpeg
        .path
        .clone()
        .ok_or_else(|| "ffmpeg is required for polish — install video tools first.".to_string())?;
    let probe = tools
        .ffprobe
        .path
        .as_deref()
        .and_then(|ffprobe| video_probe_media(ffprobe, &source_abs));
    let duration_ms = probe.as_ref().and_then(|summary| summary.duration_ms);
    let has_audio = if kind == "audio" {
        true
    } else {
        probe
            .as_ref()
            .and_then(|summary| summary.has_audio)
            .unwrap_or(false)
    };
    let ranges = video_polish_normalize_ranges(&keep_ranges, duration_ms)?;
    let kept_total_ms: u64 = ranges.iter().map(|(start, end)| end - start).sum();
    let (output_abs, output_rel) = video_polish_plan_output(&root, &media_root, &source_rel, kind)?;

    let expression = video_polish_between_expression(&ranges);
    let mut filter_parts = Vec::new();
    let mut maps: Vec<String> = Vec::new();
    if kind == "video" {
        filter_parts.push(format!(
            "[0:v]select='{expression}',setpts=N/FRAME_RATE/TB[v]"
        ));
        maps.extend(["-map".to_string(), "[v]".to_string()]);
    }
    if has_audio {
        filter_parts.push(format!("[0:a]aselect='{expression}',asetpts=N/SR/TB[a]"));
        maps.extend(["-map".to_string(), "[a]".to_string()]);
    }
    let mut args = vec![
        "-i".to_string(),
        source_abs.to_string_lossy().to_string(),
        "-filter_complex".to_string(),
        filter_parts.join(";"),
    ];
    args.extend(maps);
    if kind == "video" {
        args.extend([
            "-c:v".to_string(),
            "libx264".to_string(),
            "-preset".to_string(),
            "veryfast".to_string(),
            "-crf".to_string(),
            "18".to_string(),
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
        ]);
    }
    if has_audio {
        args.extend([
            "-c:a".to_string(),
            "aac".to_string(),
            "-b:a".to_string(),
            "192k".to_string(),
        ]);
    }
    args.extend([
        "-movflags".to_string(),
        "+faststart".to_string(),
        "-progress".to_string(),
        "pipe:1".to_string(),
        "-nostats".to_string(),
        "-y".to_string(),
        output_abs.to_string_lossy().to_string(),
    ]);

    video_polish_emit(
        &app,
        &repo_display,
        &job_id,
        &source_rel,
        "rendering",
        Some(0.0),
        "Cutting and splicing the polished version.",
        false,
        None,
        None,
    );
    let mut child = std::process::Command::new(&ffmpeg_path)
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| format!("Unable to start ffmpeg polish: {error}"))?;
    let stderr_lines = std::sync::Arc::new(std::sync::Mutex::new(
        std::collections::VecDeque::<String>::new(),
    ));
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
            if cancel.load(std::sync::atomic::Ordering::Acquire) || app_shutdown_requested() {
                let _ = child.kill();
                cancelled = true;
                break;
            }
            if let Some(out_ms) = video_parse_ffmpeg_progress_ms(&line) {
                if last_emit.elapsed()
                    >= std::time::Duration::from_millis(VIDEO_EXPORT_PROGRESS_INTERVAL_MS)
                {
                    let percent =
                        ((out_ms as f64 / kept_total_ms.max(1) as f64) * 95.0).clamp(0.0, 95.0);
                    video_polish_emit(
                        &app,
                        &repo_display,
                        &job_id,
                        &source_rel,
                        "rendering",
                        Some(percent),
                        "Cutting and splicing the polished version.",
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
        .map_err(|error| format!("Unable to wait for ffmpeg polish: {error}"))?;
    if cancelled || cancel.load(std::sync::atomic::Ordering::Acquire) {
        let _ = std::fs::remove_file(&output_abs);
        video_polish_emit(
            &app,
            &repo_display,
            &job_id,
            &source_rel,
            "cancelled",
            Some(100.0),
            "Polish cancelled.",
            true,
            None,
            None,
        );
        return Ok(());
    }
    if !status.success() || !output_abs.is_file() {
        let detail = stderr_lines
            .lock()
            .ok()
            .map(|lines| lines.iter().cloned().collect::<Vec<_>>().join("\n"))
            .unwrap_or_default();
        return Err(if detail.is_empty() {
            "ffmpeg polish failed.".to_string()
        } else {
            format!("ffmpeg polish failed: {detail}")
        });
    }

    // Lineage: polished output ← source, via "polish". The transcript
    // inheritance walker intentionally skips this via (timing changed);
    // instead the remapped transcript below becomes the output's own.
    let manifest_path = video_media_manifest_path(&media_root);
    let mut manifest_snapshot = None;
    if let Ok(_guard) = video_media_manifest_guard() {
        let mut manifest = video_read_media_manifest(&manifest_path);
        if let (Ok(output_key), Ok(source_key)) = (
            video_manifest_asset_path(&root, &media_root, &output_rel),
            video_manifest_asset_path(&root, &media_root, &source_rel),
        ) {
            if video_manifest_add_relation(&mut manifest, &output_key, &source_key, "polish", None) {
                let _ = video_write_media_manifest(&manifest_path, &manifest);
                video_emit_manifest_changed(&app, &root, &manifest_path);
            }
        }
        manifest_snapshot = Some(manifest);
    }

    video_polish_emit(
        &app,
        &repo_display,
        &job_id,
        &source_rel,
        "finalizing",
        Some(97.0),
        "Remapping the transcript onto the polished cut.",
        false,
        None,
        None,
    );
    let manifest_snapshot =
        manifest_snapshot.unwrap_or_else(|| video_read_media_manifest(&manifest_path));
    if let Ok(Some((_inherited_from, source_cache))) = video_resolve_transcript_cache(
        &root,
        &media_root,
        &manifest_snapshot,
        &source_rel,
        &source_metadata,
    ) {
        if let Ok(output_metadata) = std::fs::metadata(&output_abs) {
            let remapped = video_polish_remap_transcript(&source_cache, &ranges);
            if !remapped.segments.is_empty() {
                if let Ok(cache_path) =
                    video_transcript_cache_path(&media_root, &output_rel, &output_metadata)
                {
                    let _ = video_write_json_cache(&cache_path, &remapped, "video transcript");
                }
            }
        }
    }

    let _ = app.emit(
        VIDEO_STORE_CHANGED_EVENT,
        serde_json::json!({
            "repoPath": repo_display.clone(),
            "paths": [output_rel.clone()],
            "changedAtMs": video_now_millis(),
        }),
    );
    video_polish_emit(
        &app,
        &repo_display,
        &job_id,
        &source_rel,
        "done",
        Some(100.0),
        "Polished cut is in the library.",
        true,
        None,
        Some(&output_rel),
    );
    Ok(())
}

async fn video_polish_worker(
    app: tauri::AppHandle,
    job_id: String,
    repo_path: String,
    path: String,
    keep_ranges: Vec<VideoPolishRangeInput>,
    cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
) {
    let repo_display = resolve_workspace_root_directory(Some(repo_path.as_str()))
        .map(|root| root.to_string_lossy().to_string())
        .unwrap_or_else(|_| repo_path.clone());
    let source_display = path.clone();
    video_polish_emit(
        &app,
        &repo_display,
        &job_id,
        &source_display,
        "starting",
        Some(0.0),
        "Preparing the polish render.",
        false,
        None,
        None,
    );
    let app_for_worker = app.clone();
    let job_for_worker = job_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        video_polish_render_blocking(
            app_for_worker,
            job_for_worker,
            repo_path,
            path,
            keep_ranges,
            cancel,
        )
    })
    .await
    .map_err(|error| format!("Video polish worker failed: {error}"))
    .and_then(|value| value);
    if let Err(error) = result {
        video_polish_emit(
            &app,
            &repo_display,
            &job_id,
            &source_display,
            "error",
            Some(100.0),
            &error,
            true,
            Some(&error),
            None,
        );
    }
    video_job_registry_remove(&VIDEO_POLISH_JOBS, &job_id);
}

#[tauri::command]
async fn video_polish_start(
    app: tauri::AppHandle,
    repo_path: String,
    path: String,
    keep_ranges: Vec<VideoPolishRangeInput>,
) -> Result<VideoJobStartResult, String> {
    if keep_ranges.is_empty() {
        return Err("Polish needs at least one keep range.".to_string());
    }
    let (job_id, cancel) = video_job_registry_insert(&VIDEO_POLISH_JOBS)?;
    tauri::async_runtime::spawn(video_polish_worker(
        app,
        job_id.clone(),
        repo_path,
        path,
        keep_ranges,
        cancel,
    ));
    Ok(VideoJobStartResult { job_id })
}

#[tauri::command]
fn video_polish_cancel(job_id: String) -> Result<(), String> {
    video_job_registry_cancel(&VIDEO_POLISH_JOBS, &job_id)
}

#[cfg(test)]
mod video_polish_tests {
    fn range(start_ms: u64, end_ms: u64) -> super::VideoPolishRangeInput {
        super::VideoPolishRangeInput { start_ms, end_ms }
    }

    #[test]
    fn normalize_sorts_merges_and_clamps() {
        let ranges = vec![range(5000, 8000), range(0, 2000), range(1900, 3000), range(10, 20)];
        let merged = super::video_polish_normalize_ranges(&ranges, Some(7000)).unwrap();
        assert_eq!(merged, vec![(0, 3000), (5000, 7000)]);
    }

    #[test]
    fn normalize_rejects_empty() {
        assert!(super::video_polish_normalize_ranges(&[range(10, 20)], None).is_err());
    }

    #[test]
    fn remap_transcript_shifts_and_clips_segments() {
        let cache = super::VideoTranscriptCache {
            language: Some("en".to_string()),
            text: String::new(),
            segments: vec![
                super::VideoTranscriptSegment {
                    start_ms: 0,
                    end_ms: 1000,
                    text: "keep one".to_string(),
                    words: Vec::new(),
                },
                super::VideoTranscriptSegment {
                    start_ms: 1000,
                    end_ms: 2000,
                    text: "cut me".to_string(),
                    words: Vec::new(),
                },
                super::VideoTranscriptSegment {
                    start_ms: 2000,
                    end_ms: 3000,
                    text: "keep two".to_string(),
                    words: vec![
                        super::VideoTranscriptWord {
                            start_ms: 2000,
                            end_ms: 2400,
                            text: "keep".to_string(),
                        },
                        super::VideoTranscriptWord {
                            start_ms: 2500,
                            end_ms: 3000,
                            text: "two".to_string(),
                        },
                    ],
                },
            ],
        };
        let remapped = super::video_polish_remap_transcript(&cache, &[(0, 1000), (2000, 3000)]);
        assert_eq!(remapped.segments.len(), 2);
        assert_eq!(remapped.segments[0].start_ms, 0);
        assert_eq!(remapped.segments[0].end_ms, 1000);
        assert_eq!(remapped.segments[0].text, "keep one");
        assert_eq!(remapped.segments[1].start_ms, 1000);
        assert_eq!(remapped.segments[1].end_ms, 2000);
        assert_eq!(remapped.segments[1].words.len(), 2);
        assert_eq!(remapped.segments[1].words[0].start_ms, 1000);
        assert_eq!(remapped.segments[1].words[1].end_ms, 2000);
        assert_eq!(remapped.text, "keep one keep two");
    }
}

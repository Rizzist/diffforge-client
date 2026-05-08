fn whisper_model_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve app data directory: {error}"))?;

    Ok(app_data_dir.join("whisper"))
}

fn whisper_model_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(whisper_model_directory(app)?.join(WHISPER_MODEL_FILE))
}

fn whisper_runtime_directory(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(whisper_model_directory(app)?.join("runtime"))
}

#[cfg(windows)]
fn whisper_runtime_zip_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(whisper_model_directory(app)?.join(WHISPER_RUNTIME_ZIP_FILE))
}

#[cfg(not(windows))]
fn whisper_runtime_zip_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(whisper_model_directory(app)?.join(WHISPER_RUNTIME_ZIP_FILE))
}

fn whisper_runtime_executable_names() -> &'static [&'static str] {
    #[cfg(windows)]
    {
        &["whisper-cli.exe", "main.exe", "whisper.exe"]
    }

    #[cfg(not(windows))]
    {
        &["whisper-cli", "main", "whisper"]
    }
}

fn find_executable_on_path(names: &[&str]) -> Option<PathBuf> {
    let path_value = env::var_os("PATH")?;

    for directory in env::split_paths(&path_value) {
        for name in names {
            let candidate = directory.join(name);

            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    None
}

fn common_whisper_runtime_paths() -> Vec<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        vec![
            PathBuf::from("/opt/homebrew/bin/whisper-cli"),
            PathBuf::from("/usr/local/bin/whisper-cli"),
            PathBuf::from("/opt/homebrew/bin/main"),
            PathBuf::from("/usr/local/bin/main"),
        ]
    }

    #[cfg(target_os = "linux")]
    {
        vec![
            PathBuf::from("/usr/local/bin/whisper-cli"),
            PathBuf::from("/usr/bin/whisper-cli"),
            PathBuf::from("/usr/local/bin/main"),
            PathBuf::from("/usr/bin/main"),
        ]
    }

    #[cfg(windows)]
    {
        Vec::new()
    }
}

fn find_whisper_runtime_executable(directory: &Path) -> Option<PathBuf> {
    let mut pending = vec![directory.to_path_buf()];

    while let Some(current) = pending.pop() {
        let entries = fs::read_dir(&current).ok()?;

        for entry in entries.flatten() {
            let path = entry.path();

            if path.is_dir() {
                pending.push(path);
                continue;
            }

            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("");

            if whisper_runtime_executable_names()
                .iter()
                .any(|runtime_name| runtime_name.eq_ignore_ascii_case(name))
            {
                return Some(path);
            }
        }
    }

    None
}

fn whisper_runtime_executable_path(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    if let Some(runtime) = find_whisper_runtime_executable(&whisper_runtime_directory(app)?) {
        return Ok(Some(runtime));
    }

    if let Some(runtime) = find_executable_on_path(whisper_runtime_executable_names()) {
        return Ok(Some(runtime));
    }

    Ok(common_whisper_runtime_paths()
        .into_iter()
        .find(|candidate| candidate.is_file()))
}

fn whisper_model_status_for(app: &AppHandle) -> Result<WhisperModelStatus, String> {
    let model_path = whisper_model_path(app)?;
    let runtime_path = whisper_runtime_executable_path(app)?;
    let bytes = fs::metadata(&model_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let model_installed = bytes > 0;
    let runtime_installed = runtime_path.is_some();

    Ok(WhisperModelStatus {
        installed: model_installed && runtime_installed,
        model_installed,
        runtime_installed,
        model_id: WHISPER_MODEL_ID,
        model_name: WHISPER_MODEL_NAME,
        model_file: WHISPER_MODEL_FILE,
        model_path: model_path.display().to_string(),
        runtime_name: WHISPER_RUNTIME_NAME,
        runtime_package_name: WHISPER_RUNTIME_PACKAGE_NAME,
        runtime_path: runtime_path
            .map(|path| path.display().to_string())
            .unwrap_or_else(|| {
                whisper_runtime_directory(app)
                    .map(|path| path.display().to_string())
                    .unwrap_or_default()
            }),
        runtime_installable: WHISPER_RUNTIME_URL.is_some(),
        runtime_install_hint: WHISPER_RUNTIME_INSTALL_HINT,
        download_url: WHISPER_MODEL_URL,
        expected_sha1: WHISPER_MODEL_SHA1,
        approximate_disk_mb: WHISPER_MODEL_DISK_MB,
        approximate_memory_mb: WHISPER_MODEL_MEMORY_MB,
        bytes,
        shortcut: AUDIO_SHORTCUT,
    })
}

fn emit_audio_download_progress(app: &AppHandle, progress: WhisperModelDownloadProgress) {
    let _ = app.emit(AUDIO_MODEL_DOWNLOAD_PROGRESS_EVENT, progress);
}

fn sha1_file(path: &Path) -> Result<String, String> {
    let mut file =
        fs::File::open(path).map_err(|error| format!("Unable to verify Whisper model: {error}"))?;
    let mut hasher = Sha1::new();
    let mut buffer = [0u8; 64 * 1024];

    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("Unable to verify Whisper model: {error}"))?;

        if read == 0 {
            break;
        }

        hasher.update(&buffer[..read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path)
        .map_err(|error| format!("Unable to verify Whisper runtime: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];

    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("Unable to verify Whisper runtime: {error}"))?;

        if read == 0 {
            break;
        }

        hasher.update(&buffer[..read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

fn extract_zip_file(zip_path: &Path, destination: &Path) -> Result<(), String> {
    let file = fs::File::open(zip_path)
        .map_err(|error| format!("Unable to open Whisper runtime archive: {error}"))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| format!("Unable to read Whisper runtime archive: {error}"))?;

    fs::create_dir_all(destination)
        .map_err(|error| format!("Unable to prepare Whisper runtime directory: {error}"))?;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Unable to extract Whisper runtime: {error}"))?;
        let enclosed_name = entry
            .enclosed_name()
            .ok_or_else(|| "Whisper runtime archive contains an unsafe path.".to_string())?;
        let output_path = destination.join(enclosed_name);

        if entry.is_dir() {
            fs::create_dir_all(&output_path)
                .map_err(|error| format!("Unable to create runtime directory: {error}"))?;
            continue;
        }

        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Unable to create runtime directory: {error}"))?;
        }

        let mut output = fs::File::create(&output_path)
            .map_err(|error| format!("Unable to write Whisper runtime file: {error}"))?;
        std::io::copy(&mut entry, &mut output)
            .map_err(|error| format!("Unable to write Whisper runtime file: {error}"))?;
    }

    Ok(())
}

fn normalize_transcript_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn clean_transcript_for_insert(text: String) -> Result<String, String> {
    let cleaned = text
        .chars()
        .filter(|character| !character.is_control() || matches!(character, '\n' | '\r' | '\t'))
        .collect::<String>()
        .trim()
        .to_string();

    if cleaned.is_empty() {
        return Err("Whisper did not produce any text to insert.".to_string());
    }

    if cleaned.chars().count() > MAX_AUDIO_TRANSCRIPT_INSERT_CHARS {
        return Err(format!(
            "Transcripts are limited to {MAX_AUDIO_TRANSCRIPT_INSERT_CHARS} characters."
        ));
    }

    Ok(cleaned)
}

fn transcribe_whisper_audio_for(
    app: &AppHandle,
    request: WhisperTranscriptionRequest,
) -> Result<WhisperTranscriptionResult, String> {
    if request.audio_base64.len() > WHISPER_MAX_AUDIO_BYTES * 2 {
        return Err("Recorded audio is too large to transcribe.".to_string());
    }

    let audio_bytes = general_purpose::STANDARD
        .decode(request.audio_base64.trim())
        .map_err(|error| format!("Recorded audio is not valid base64: {error}"))?;

    if audio_bytes.len() > WHISPER_MAX_AUDIO_BYTES {
        return Err("Recorded audio is too large to transcribe.".to_string());
    }

    let model_path = whisper_model_path(app)?;
    let runtime_path = whisper_runtime_executable_path(app)?
        .ok_or_else(|| "Install the local Whisper runtime before recording.".to_string())?;

    if !model_path.exists() {
        return Err("Install the local Whisper model before recording.".to_string());
    }

    let started_at = Instant::now();
    let temp_directory = whisper_model_directory(app)?.join("recordings");
    fs::create_dir_all(&temp_directory)
        .map_err(|error| format!("Unable to prepare audio recording directory: {error}"))?;

    let recording_id = current_time_ms();
    let audio_path = temp_directory.join(format!("recording-{recording_id}.wav"));
    let output_prefix = temp_directory.join(format!("transcript-{recording_id}"));
    let transcript_path = output_prefix.with_extension("txt");

    fs::write(&audio_path, &audio_bytes)
        .map_err(|error| format!("Unable to prepare microphone audio: {error}"))?;

    let runtime = runtime_path.display().to_string();
    let model = model_path.display().to_string();
    let audio = audio_path.display().to_string();
    let output = output_prefix.display().to_string();
    let args = vec![
        "-m".to_string(),
        model,
        "-f".to_string(),
        audio,
        "-l".to_string(),
        "en".to_string(),
        "-nt".to_string(),
        "-otxt".to_string(),
        "-of".to_string(),
        output,
    ];
    let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    let capture_result = run_command_capture(
        &runtime,
        &arg_refs,
        None,
        Duration::from_secs(WHISPER_TRANSCRIBE_TIMEOUT_SECS),
        None,
    );
    let capture = match capture_result {
        Ok(capture) => capture,
        Err(error) => {
            let _ = fs::remove_file(&audio_path);
            let _ = fs::remove_file(&transcript_path);
            return Err(error);
        }
    };

    let transcript = fs::read_to_string(&transcript_path)
        .unwrap_or_else(|_| command_output_text(&capture.stdout, &capture.stderr));
    let text = normalize_transcript_text(&transcript);
    let _ = fs::remove_file(&audio_path);
    let _ = fs::remove_file(&transcript_path);

    if capture.exit_code != Some(0) && text.is_empty() {
        return Err(
            first_output_line(&command_output_text(&capture.stdout, &capture.stderr))
                .chars()
                .take(240)
                .collect::<String>(),
        );
    }

    Ok(WhisperTranscriptionResult {
        text,
        segments: if transcript.trim().is_empty() { 0 } else { 1 },
        duration_ms: started_at.elapsed().as_millis(),
    })
}

fn ensure_audio_widget_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(AUDIO_WIDGET_WINDOW_LABEL) {
        return Ok(window);
    }

    WebviewWindowBuilder::new(
        app,
        AUDIO_WIDGET_WINDOW_LABEL,
        WebviewUrl::App("index.html#/audio-widget".into()),
    )
    .title("Diff Forge Audio")
    .inner_size(380.0, 430.0)
    .min_inner_size(340.0, 380.0)
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .focused(false)
    .visible(false)
    .shadow(true)
    .build()
    .map_err(|error| format!("Unable to create audio widget: {error}"))
}

fn show_audio_widget_for(app: &AppHandle) -> Result<AudioWidgetVisibility, String> {
    let status = whisper_model_status_for(app)?;

    if !status.installed {
        if !status.model_installed {
            return Err(
                "Install the local Whisper model before opening the audio widget.".to_string(),
            );
        }

        return Err(WHISPER_RUNTIME_INSTALL_HINT.to_string());
    }

    let window = ensure_audio_widget_window(app)?;
    window
        .show()
        .map_err(|error| format!("Unable to show audio widget: {error}"))?;

    let _ = app.emit_to(AUDIO_WIDGET_WINDOW_LABEL, AUDIO_WIDGET_ARM_EVENT, ());
    let app_for_retry = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(350));
        let _ = app_for_retry.emit_to(AUDIO_WIDGET_WINDOW_LABEL, AUDIO_WIDGET_ARM_EVENT, ());
    });

    Ok(AudioWidgetVisibility {
        visible: true,
        installed: true,
        shortcut: AUDIO_SHORTCUT,
    })
}

fn hide_audio_widget_for(app: &AppHandle) -> Result<AudioWidgetVisibility, String> {
    if let Some(window) = app.get_webview_window(AUDIO_WIDGET_WINDOW_LABEL) {
        window
            .hide()
            .map_err(|error| format!("Unable to hide audio widget: {error}"))?;
    }

    Ok(AudioWidgetVisibility {
        visible: false,
        installed: whisper_model_status_for(app)?.installed,
        shortcut: AUDIO_SHORTCUT,
    })
}

fn toggle_audio_widget_for(app: &AppHandle) -> Result<AudioWidgetVisibility, String> {
    if let Some(window) = app.get_webview_window(AUDIO_WIDGET_WINDOW_LABEL) {
        if window.is_visible().unwrap_or(false) {
            return hide_audio_widget_for(app);
        }
    }

    show_audio_widget_for(app)
}

#[cfg(windows)]
fn windows_unicode_input(scan: u16, key_up: bool) -> WindowsInput {
    WindowsInput {
        input_type: INPUT_KEYBOARD,
        union: WindowsInputUnion {
            ki: WindowsKeyboardInput {
                w_vk: 0,
                w_scan: scan,
                dw_flags: KEYEVENTF_UNICODE | if key_up { KEYEVENTF_KEYUP } else { 0 },
                time: 0,
                dw_extra_info: 0,
            },
        },
    }
}

#[cfg(windows)]
fn insert_text_into_focused_target(text: &str) -> Result<(), String> {
    let normalized = text
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace('\n', "\r");
    let units = normalized.encode_utf16().collect::<Vec<_>>();

    if units.is_empty() {
        return Err("No text was produced for insertion.".to_string());
    }

    let mut inputs = Vec::with_capacity(units.len() * 2);

    for unit in units {
        inputs.push(windows_unicode_input(unit, false));
        inputs.push(windows_unicode_input(unit, true));
    }

    let sent = unsafe {
        SendInput(
            inputs.len() as u32,
            inputs.as_mut_ptr(),
            std::mem::size_of::<WindowsInput>() as i32,
        )
    };

    if sent != inputs.len() as u32 {
        return Err("Windows did not accept the full transcript insertion.".to_string());
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn insert_text_into_focused_target(text: &str) -> Result<(), String> {
    run_command_capture("pbcopy", &[], Some(text), Duration::from_secs(3), None)?;
    let paste = run_command_capture(
        "osascript",
        &[
            "-e",
            "tell application \"System Events\" to keystroke \"v\" using command down",
        ],
        None,
        Duration::from_secs(4),
        None,
    )?;

    if paste.exit_code == Some(0) {
        Ok(())
    } else {
        Err(first_output_line(&command_output_text(
            &paste.stdout,
            &paste.stderr,
        )))
    }
}

#[cfg(target_os = "linux")]
fn insert_text_into_focused_target(text: &str) -> Result<(), String> {
    let mut errors = Vec::new();

    match run_command_capture(
        "xdotool",
        &["type", "--clearmodifiers", "--delay", "0", text],
        None,
        Duration::from_secs(5),
        None,
    ) {
        Ok(capture) if capture.exit_code == Some(0) => return Ok(()),
        Ok(capture) => errors.push(command_output_text(&capture.stdout, &capture.stderr)),
        Err(error) => errors.push(error),
    }

    match run_command_capture("wtype", &[text], None, Duration::from_secs(5), None) {
        Ok(capture) if capture.exit_code == Some(0) => return Ok(()),
        Ok(capture) => errors.push(command_output_text(&capture.stdout, &capture.stderr)),
        Err(error) => errors.push(error),
    }

    let wl_clipboard_set =
        run_command_capture("wl-copy", &[], Some(text), Duration::from_secs(3), None);
    if wl_clipboard_set.is_ok() {
        match run_command_capture(
            "wtype",
            &["-M", "ctrl", "v", "-m", "ctrl"],
            None,
            Duration::from_secs(5),
            None,
        ) {
            Ok(capture) if capture.exit_code == Some(0) => return Ok(()),
            Ok(capture) => errors.push(command_output_text(&capture.stdout, &capture.stderr)),
            Err(error) => errors.push(error),
        }
    } else if let Err(error) = wl_clipboard_set {
        errors.push(error);
    }

    let x_clipboard_set = run_command_capture(
        "xclip",
        &["-selection", "clipboard"],
        Some(text),
        Duration::from_secs(3),
        None,
    );
    if x_clipboard_set.is_ok() {
        match run_command_capture(
            "xdotool",
            &["key", "--clearmodifiers", "ctrl+v"],
            None,
            Duration::from_secs(5),
            None,
        ) {
            Ok(capture) if capture.exit_code == Some(0) => return Ok(()),
            Ok(capture) => errors.push(command_output_text(&capture.stdout, &capture.stderr)),
            Err(error) => errors.push(error),
        }
    } else if let Err(error) = x_clipboard_set {
        errors.push(error);
    }

    let detail = errors
        .into_iter()
        .map(|error| error.trim().to_string())
        .find(|error| !error.is_empty())
        .unwrap_or_else(|| "No supported Linux text insertion helper succeeded.".to_string());

    Err(format!(
        "Unable to insert transcript on Linux. Install xdotool for X11 or wtype/wl-copy for Wayland. {detail}"
    ))
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
fn insert_text_into_focused_target(_text: &str) -> Result<(), String> {
    Err("Focused transcript insertion is not supported on this platform yet.".to_string())
}

#[tauri::command]
async fn whisper_model_status(app: AppHandle) -> Result<WhisperModelStatus, String> {
    whisper_model_status_for(&app)
}

#[tauri::command]
async fn download_whisper_model(
    app: AppHandle,
    audio_state: State<'_, AudioState>,
) -> Result<WhisperModelStatus, String> {
    let _download_guard = audio_state.download_lock.lock().await;
    let model_directory = whisper_model_directory(&app)?;
    let model_path = model_directory.join(WHISPER_MODEL_FILE);
    let temp_path = model_directory.join(format!("{WHISPER_MODEL_FILE}.download"));

    fs::create_dir_all(&model_directory)
        .map_err(|error| format!("Unable to create Whisper model directory: {error}"))?;

    if !model_path.exists() {
        emit_audio_download_progress(
            &app,
            WhisperModelDownloadProgress {
                state: "starting".to_string(),
                downloaded_bytes: 0,
                total_bytes: None,
                percent: None,
                message: format!("Downloading {WHISPER_MODEL_NAME}."),
            },
        );

        let client = http_client(Duration::from_secs(WHISPER_DOWNLOAD_TIMEOUT_SECS))?;
        let mut response = client
            .get(WHISPER_MODEL_URL)
            .send()
            .await
            .map_err(|error| format!("Unable to download Whisper model: {error}"))?;

        if !response.status().is_success() {
            return Err(format!(
                "Whisper model download returned HTTP {}.",
                response.status()
            ));
        }

        let total_bytes = response.content_length();
        let mut downloaded_bytes = 0u64;
        let mut file = fs::File::create(&temp_path)
            .map_err(|error| format!("Unable to write Whisper model: {error}"))?;

        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| format!("Unable to read Whisper model download: {error}"))?
        {
            file.write_all(&chunk)
                .map_err(|error| format!("Unable to write Whisper model: {error}"))?;
            downloaded_bytes += chunk.len() as u64;
            let percent = total_bytes
                .filter(|total| *total > 0)
                .map(|total| (downloaded_bytes as f64 / total as f64) * 100.0);

            emit_audio_download_progress(
                &app,
                WhisperModelDownloadProgress {
                    state: "downloading".to_string(),
                    downloaded_bytes,
                    total_bytes,
                    percent,
                    message: "Downloading local Whisper weights.".to_string(),
                },
            );
        }

        file.flush()
            .map_err(|error| format!("Unable to finish Whisper model write: {error}"))?;
        let downloaded_sha1 = sha1_file(&temp_path)?;

        if downloaded_sha1 != WHISPER_MODEL_SHA1 {
            let _ = fs::remove_file(&temp_path);
            return Err("Downloaded Whisper model failed checksum verification.".to_string());
        }

        fs::rename(&temp_path, &model_path)
            .map_err(|error| format!("Unable to install Whisper model: {error}"))?;
    }

    if whisper_runtime_executable_path(&app)?.is_none() {
        let Some(runtime_url) = WHISPER_RUNTIME_URL else {
            emit_audio_download_progress(
                &app,
                WhisperModelDownloadProgress {
                    state: "runtime-missing".to_string(),
                    downloaded_bytes: 0,
                    total_bytes: None,
                    percent: Some(100.0),
                    message: WHISPER_RUNTIME_INSTALL_HINT.to_string(),
                },
            );

            return whisper_model_status_for(&app);
        };
        let runtime_sha256 = WHISPER_RUNTIME_SHA256
            .ok_or_else(|| "Whisper runtime checksum is not configured.".to_string())?;
        let runtime_directory = whisper_runtime_directory(&app)?;
        let runtime_zip_path = whisper_runtime_zip_path(&app)?;
        let runtime_temp_path =
            model_directory.join(format!("{WHISPER_RUNTIME_ZIP_FILE}.download"));

        emit_audio_download_progress(
            &app,
            WhisperModelDownloadProgress {
                state: "runtime".to_string(),
                downloaded_bytes: 0,
                total_bytes: None,
                percent: None,
                message: format!("Downloading {WHISPER_RUNTIME_NAME}."),
            },
        );

        let client = http_client(Duration::from_secs(WHISPER_DOWNLOAD_TIMEOUT_SECS))?;
        let mut response = client
            .get(runtime_url)
            .send()
            .await
            .map_err(|error| format!("Unable to download Whisper runtime: {error}"))?;

        if !response.status().is_success() {
            return Err(format!(
                "Whisper runtime download returned HTTP {}.",
                response.status()
            ));
        }

        let total_bytes = response.content_length();
        let mut downloaded_bytes = 0u64;
        let mut file = fs::File::create(&runtime_temp_path)
            .map_err(|error| format!("Unable to write Whisper runtime: {error}"))?;

        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| format!("Unable to read Whisper runtime download: {error}"))?
        {
            file.write_all(&chunk)
                .map_err(|error| format!("Unable to write Whisper runtime: {error}"))?;
            downloaded_bytes += chunk.len() as u64;
            let percent = total_bytes
                .filter(|total| *total > 0)
                .map(|total| (downloaded_bytes as f64 / total as f64) * 100.0);

            emit_audio_download_progress(
                &app,
                WhisperModelDownloadProgress {
                    state: "runtime".to_string(),
                    downloaded_bytes,
                    total_bytes,
                    percent,
                    message: "Downloading local Whisper runtime.".to_string(),
                },
            );
        }

        file.flush()
            .map_err(|error| format!("Unable to finish Whisper runtime write: {error}"))?;
        let downloaded_sha256 = sha256_file(&runtime_temp_path)?;

        if downloaded_sha256 != runtime_sha256 {
            let _ = fs::remove_file(&runtime_temp_path);
            return Err("Downloaded Whisper runtime failed checksum verification.".to_string());
        }

        fs::rename(&runtime_temp_path, &runtime_zip_path)
            .map_err(|error| format!("Unable to install Whisper runtime archive: {error}"))?;
        extract_zip_file(&runtime_zip_path, &runtime_directory)?;
    }

    emit_audio_download_progress(
        &app,
        WhisperModelDownloadProgress {
            state: "done".to_string(),
            downloaded_bytes: 0,
            total_bytes: None,
            percent: Some(100.0),
            message: "Whisper is installed locally.".to_string(),
        },
    );

    whisper_model_status_for(&app)
}

#[tauri::command]
async fn transcribe_whisper_audio(
    app: AppHandle,
    request: WhisperTranscriptionRequest,
) -> Result<WhisperTranscriptionResult, String> {
    tauri::async_runtime::spawn_blocking(move || transcribe_whisper_audio_for(&app, request))
        .await
        .map_err(|error| format!("Unable to run local Whisper transcription: {error}"))?
}

#[tauri::command]
async fn show_audio_widget(app: AppHandle) -> Result<AudioWidgetVisibility, String> {
    show_audio_widget_for(&app)
}

#[tauri::command]
async fn hide_audio_widget(app: AppHandle) -> Result<AudioWidgetVisibility, String> {
    hide_audio_widget_for(&app)
}

#[tauri::command]
async fn toggle_audio_widget(app: AppHandle) -> Result<AudioWidgetVisibility, String> {
    toggle_audio_widget_for(&app)
}

#[tauri::command]
async fn insert_transcribed_text(
    app: AppHandle,
    text: String,
) -> Result<AudioWidgetVisibility, String> {
    let text = clean_transcript_for_insert(text)?;

    if let Some(window) = app.get_webview_window(AUDIO_WIDGET_WINDOW_LABEL) {
        let _ = window.hide();
    }

    let insert_result = tauri::async_runtime::spawn_blocking(move || {
        thread::sleep(Duration::from_millis(220));
        insert_text_into_focused_target(&text)
    })
    .await
    .map_err(|error| format!("Unable to insert transcript: {error}"))?;

    if let Err(error) = insert_result {
        if let Some(window) = app.get_webview_window(AUDIO_WIDGET_WINDOW_LABEL) {
            let _ = window.show();
            let _ = window.set_focus();
        }

        return Err(error);
    }

    Ok(AudioWidgetVisibility {
        visible: false,
        installed: whisper_model_status_for(&app)?.installed,
        shortcut: AUDIO_SHORTCUT,
    })
}


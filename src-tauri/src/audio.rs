use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

fn whisper_local_audio_log_path() -> PathBuf {
    let tauri_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let project_root = tauri_root
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or(tauri_root);

    project_root
        .join(TERMINAL_TELEMETRY_LOG_DIR)
        .join(WHISPER_LOCAL_AUDIO_LOG_FILE)
}

fn clean_whisper_local_audio_log_text(value: &str) -> String {
    value
        .replace(|character: char| character.is_control(), " ")
        .trim()
        .chars()
        .take(WHISPER_LOCAL_AUDIO_LOG_MAX_TEXT)
        .collect()
}

fn write_whisper_local_audio_log(entry: Value) {
    if !WHISPER_LOCAL_AUDIO_LOGGING_ENABLED {
        return;
    }

    let log_path = whisper_local_audio_log_path();
    let Some(log_dir) = log_path.parent() else {
        return;
    };

    if fs::create_dir_all(log_dir).is_err() {
        return;
    }

    let lock = WHISPER_LOCAL_AUDIO_LOG_LOCK.get_or_init(|| StdMutex::new(()));
    let Ok(_guard) = lock.lock() else {
        return;
    };

    let Ok(mut file) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    else {
        return;
    };

    let _ = writeln!(file, "{entry}");
}

fn log_whisper_local_audio_event(phase: &str, elapsed: Option<Duration>, fields: Value) {
    write_whisper_local_audio_log(json!({
        "ts_ms": current_time_ms(),
        "phase": clean_whisper_local_audio_log_text(phase),
        "elapsed_ms": elapsed.map(|duration| duration.as_secs_f64() * 1000.0),
        "fields": fields,
    }));
}

struct WhisperCliWarmCacheState {
    model_bytes: u64,
    model_path: Option<PathBuf>,
    warmed_at: Option<Instant>,
}

#[derive(Clone)]
struct WhisperCliWarmCache {
    state: Arc<StdMutex<WhisperCliWarmCacheState>>,
}

impl WhisperCliWarmCache {
    fn new() -> Self {
        Self {
            state: Arc::new(StdMutex::new(WhisperCliWarmCacheState {
                model_bytes: 0,
                model_path: None,
                warmed_at: None,
            })),
        }
    }

    fn clear(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.model_bytes = 0;
            state.model_path = None;
            state.warmed_at = None;
        }
    }

    fn prepare(&self, model_path: &Path) -> Result<WhisperWarmStatus, String> {
        let started_at = Instant::now();
        let metadata = fs::metadata(model_path)
            .map_err(|_| "Install the local Whisper model before recording.".to_string())?;
        let model_bytes = metadata.len();

        {
            let state = self
                .state
                .lock()
                .map_err(|_| "Unable to lock local Whisper warm cache.".to_string())?;

            if state.model_path.as_deref() == Some(model_path) && state.model_bytes == model_bytes {
                log_whisper_local_audio_event(
                    "whisper.cache_warm.hit",
                    Some(started_at.elapsed()),
                    json!({
                        "model_path": model_path.display().to_string(),
                        "model_bytes": model_bytes,
                    }),
                );

                return Ok(WhisperWarmStatus {
                    prepared: true,
                    cached: true,
                    model_path: model_path.display().to_string(),
                    elapsed_ms: started_at.elapsed().as_millis(),
                    warmed_bytes: 0,
                });
            }
        }

        let warmed_bytes = warm_whisper_model_file_cache(model_path)?;
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Unable to lock local Whisper warm cache.".to_string())?;
        state.model_bytes = model_bytes;
        state.model_path = Some(model_path.to_path_buf());
        state.warmed_at = Some(Instant::now());

        log_whisper_local_audio_event(
            "whisper.cache_warm.done",
            Some(started_at.elapsed()),
            json!({
                "model_path": model_path.display().to_string(),
                "model_bytes": model_bytes,
                "warmed_bytes": warmed_bytes,
            }),
        );

        Ok(WhisperWarmStatus {
            prepared: true,
            cached: false,
            model_path: model_path.display().to_string(),
            elapsed_ms: started_at.elapsed().as_millis(),
            warmed_bytes,
        })
    }
}

fn warm_whisper_model_file_cache(model_path: &Path) -> Result<u64, String> {
    let mut file = fs::File::open(model_path)
        .map_err(|error| format!("Unable to warm local Whisper model cache: {error}"))?;
    let mut buffer = [0u8; 256 * 1024];
    let mut total = 0u64;

    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("Unable to warm local Whisper model cache: {error}"))?;

        if read == 0 {
            break;
        }

        total += read as u64;
    }

    Ok(total)
}

struct NativeAudioChunk {
    duration_ms: f64,
    samples: Vec<f32>,
    timestamp: Instant,
}

struct NativeAudioShared {
    capture_chunk_count: u64,
    capture_input_ms: f64,
    capture_peak: f32,
    capture_rms: f32,
    capture_started_at: Option<Instant>,
    chunks: VecDeque<NativeAudioChunk>,
    input_chunk_count: u64,
    last_stats_at: Instant,
    realtime_audio_tx: Option<mpsc::UnboundedSender<Vec<u8>>>,
    sample_rate: u32,
    total_samples: usize,
}

impl NativeAudioShared {
    fn new(sample_rate: u32) -> Self {
        Self {
            capture_chunk_count: 0,
            capture_input_ms: 0.0,
            capture_peak: 0.0,
            capture_rms: 0.0,
            capture_started_at: None,
            chunks: VecDeque::new(),
            input_chunk_count: 0,
            last_stats_at: Instant::now(),
            realtime_audio_tx: None,
            sample_rate,
            total_samples: 0,
        }
    }
}

struct NativeAudioSession {
    device_id: String,
    label: String,
    owners: HashSet<String>,
    sample_rate: u32,
    shared: Arc<StdMutex<NativeAudioShared>>,
    _stream: cpal::Stream,
}

enum NativeAudioCommand {
    AttachRealtime {
        audio_tx: mpsc::UnboundedSender<Vec<u8>>,
        response: std::sync::mpsc::Sender<Result<AudioInputMonitorStatus, String>>,
    },
    Begin {
        response: std::sync::mpsc::Sender<Result<(), String>>,
    },
    DetachRealtime {
        response: std::sync::mpsc::Sender<Result<(), String>>,
    },
    Finish {
        response: std::sync::mpsc::Sender<Result<AudioInputCaptureResult, String>>,
    },
    Start {
        app: AppHandle,
        request: AudioInputMonitorRequest,
        response: std::sync::mpsc::Sender<Result<AudioInputMonitorStatus, String>>,
    },
    Stop {
        request: Option<AudioInputMonitorRequest>,
        response: std::sync::mpsc::Sender<Result<AudioInputMonitorStatus, String>>,
    },
}

#[derive(Clone)]
struct NativeAudioWorker {
    command_tx: std::sync::mpsc::Sender<NativeAudioCommand>,
}

impl NativeAudioWorker {
    fn new() -> Self {
        let (command_tx, command_rx) = std::sync::mpsc::channel::<NativeAudioCommand>();

        thread::spawn(move || native_audio_worker_loop(command_rx));

        Self { command_tx }
    }

    fn attach_realtime_stream(
        &self,
        audio_tx: mpsc::UnboundedSender<Vec<u8>>,
    ) -> Result<AudioInputMonitorStatus, String> {
        let (response, response_rx) = std::sync::mpsc::channel();
        self.command_tx
            .send(NativeAudioCommand::AttachRealtime { audio_tx, response })
            .map_err(|_| "Native audio worker is unavailable.".to_string())?;
        response_rx
            .recv()
            .map_err(|_| "Native audio worker did not respond.".to_string())?
    }

    fn begin_capture(&self) -> Result<(), String> {
        let (response, response_rx) = std::sync::mpsc::channel();
        self.command_tx
            .send(NativeAudioCommand::Begin { response })
            .map_err(|_| "Native audio worker is unavailable.".to_string())?;
        response_rx
            .recv()
            .map_err(|_| "Native audio worker did not respond.".to_string())?
    }

    fn finish_capture(&self) -> Result<AudioInputCaptureResult, String> {
        let (response, response_rx) = std::sync::mpsc::channel();
        self.command_tx
            .send(NativeAudioCommand::Finish { response })
            .map_err(|_| "Native audio worker is unavailable.".to_string())?;
        response_rx
            .recv()
            .map_err(|_| "Native audio worker did not respond.".to_string())?
    }

    fn detach_realtime_stream(&self) -> Result<(), String> {
        let (response, response_rx) = std::sync::mpsc::channel();
        self.command_tx
            .send(NativeAudioCommand::DetachRealtime { response })
            .map_err(|_| "Native audio worker is unavailable.".to_string())?;
        response_rx
            .recv()
            .map_err(|_| "Native audio worker did not respond.".to_string())?
    }

    fn start_monitor(
        &self,
        app: AppHandle,
        request: AudioInputMonitorRequest,
    ) -> Result<AudioInputMonitorStatus, String> {
        let (response, response_rx) = std::sync::mpsc::channel();
        self.command_tx
            .send(NativeAudioCommand::Start {
                app,
                request,
                response,
            })
            .map_err(|_| "Native audio worker is unavailable.".to_string())?;
        response_rx
            .recv()
            .map_err(|_| "Native audio worker did not respond.".to_string())?
    }

    fn stop_monitor(
        &self,
        request: Option<AudioInputMonitorRequest>,
    ) -> Result<AudioInputMonitorStatus, String> {
        let (response, response_rx) = std::sync::mpsc::channel();
        self.command_tx
            .send(NativeAudioCommand::Stop { request, response })
            .map_err(|_| "Native audio worker is unavailable.".to_string())?;
        response_rx
            .recv()
            .map_err(|_| "Native audio worker did not respond.".to_string())?
    }
}

fn inactive_native_audio_status() -> AudioInputMonitorStatus {
    AudioInputMonitorStatus {
        monitoring: false,
        device_id: String::new(),
        label: String::new(),
        sample_rate: AUDIO_TARGET_SAMPLE_RATE,
        owner_count: 0,
    }
}

fn native_audio_worker_loop(command_rx: std::sync::mpsc::Receiver<NativeAudioCommand>) {
    let mut session: Option<NativeAudioSession> = None;

    while let Ok(command) = command_rx.recv() {
        match command {
            NativeAudioCommand::AttachRealtime { audio_tx, response } => {
                let result = attach_native_audio_realtime_stream(session.as_ref(), audio_tx);
                let _ = response.send(result);
            }
            NativeAudioCommand::Begin { response } => {
                let result = begin_native_audio_capture_for_session(session.as_ref());
                let _ = response.send(result);
            }
            NativeAudioCommand::DetachRealtime { response } => {
                let result = detach_native_audio_realtime_stream(session.as_ref());
                let _ = response.send(result);
            }
            NativeAudioCommand::Finish { response } => {
                let result = finish_native_audio_capture_for_session(session.as_ref());
                let _ = response.send(result);
            }
            NativeAudioCommand::Start {
                app,
                request,
                response,
            } => {
                let result = start_native_audio_session(&mut session, app, request);
                let _ = response.send(result);
            }
            NativeAudioCommand::Stop { request, response } => {
                let result = stop_native_audio_session(&mut session, request);
                let _ = response.send(result);
            }
        }
    }
}

fn audio_owner_label(owner: Option<String>) -> String {
    owner
        .unwrap_or_else(|| "audio".to_string())
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        .take(48)
        .collect::<String>()
}

fn native_audio_error_message(error: impl std::fmt::Display) -> String {
    let message = error.to_string();
    let lowercase = message.to_lowercase();

    if lowercase.contains("permission") || lowercase.contains("denied") {
        "Diff Forge cannot access that input through the operating system right now. Check system microphone access, then use Enable input here.".to_string()
    } else if lowercase.contains("not found") || lowercase.contains("no input") {
        "That input source is not available. Choose another microphone and refresh sources.".to_string()
    } else if lowercase.contains("busy")
        || lowercase.contains("in use")
        || lowercase.contains("could not start")
    {
        "That input source could not be opened. Check the OS input settings or choose another source, then try again.".to_string()
    } else {
        message
    }
}

fn cpal_host() -> cpal::Host {
    cpal::default_host()
}

fn audio_input_devices_for_host(host: &cpal::Host) -> Result<Vec<AudioInputDeviceSummary>, String> {
    let default_name = host
        .default_input_device()
        .and_then(|device| device.name().ok());
    let mut devices = Vec::new();

    if let Some(default_label) = default_name.as_deref() {
        devices.push(AudioInputDeviceSummary {
            device_id: "default".to_string(),
            label: format!("Default microphone - {default_label}"),
            is_default: true,
        });
    }

    let input_devices = host
        .input_devices()
        .map_err(|error| native_audio_error_message(error))?;

    for (index, device) in input_devices.enumerate() {
        let label = device
            .name()
            .unwrap_or_else(|_| format!("Microphone {}", index + 1));
        let is_default = default_name
            .as_ref()
            .map(|default| default == &label)
            .unwrap_or(false);

        devices.push(AudioInputDeviceSummary {
            device_id: index.to_string(),
            label,
            is_default,
        });
    }

    Ok(devices)
}

fn cpal_input_device_by_id(device_id: &str) -> Result<(cpal::Device, String, String), String> {
    let host = cpal_host();

    if device_id.is_empty() || device_id == "default" {
        let device = host
            .default_input_device()
            .ok_or_else(|| "No default microphone was found.".to_string())?;
        let label = device
            .name()
            .unwrap_or_else(|_| "Default microphone".to_string());

        return Ok((device, "default".to_string(), label));
    }

    let target_index = device_id
        .parse::<usize>()
        .map_err(|_| "That input source is not available. Choose another microphone and refresh sources.".to_string())?;
    let mut input_devices = host
        .input_devices()
        .map_err(|error| native_audio_error_message(error))?;
    let device = input_devices
        .nth(target_index)
        .ok_or_else(|| "That input source is not available. Choose another microphone and refresh sources.".to_string())?;
    let label = device
        .name()
        .unwrap_or_else(|_| format!("Microphone {}", target_index + 1));

    Ok((device, target_index.to_string(), label))
}

fn native_audio_stats(samples: &[f32]) -> (f32, f32) {
    let mut sum_squares = 0.0f32;
    let mut peak = 0.0f32;

    for sample in samples {
        let value = if sample.is_finite() { *sample } else { 0.0 };
        sum_squares += value * value;
        peak = peak.max(value.abs());
    }

    ((sum_squares / samples.len().max(1) as f32).sqrt(), peak)
}

fn native_audio_mono_samples<T, F>(data: &[T], channels: usize, convert: F) -> Vec<f32>
where
    F: Fn(&T) -> f32,
{
    let channel_count = channels.max(1);
    let mut samples = Vec::with_capacity(data.len() / channel_count);

    for frame in data.chunks(channel_count) {
        let mixed = frame.iter().map(&convert).sum::<f32>() / frame.len().max(1) as f32;
        samples.push(mixed.clamp(-1.0, 1.0));
    }

    samples
}

fn encode_linear16_audio(samples: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(samples.len() * 2);

    for sample in samples {
        let clipped = sample.clamp(-1.0, 1.0);
        let value = if clipped < 0.0 {
            (clipped * 32768.0) as i16
        } else {
            (clipped * 32767.0) as i16
        };
        bytes.extend_from_slice(&value.to_le_bytes());
    }

    bytes
}

fn native_audio_trim(shared: &mut NativeAudioShared) {
    let max_samples = (shared.sample_rate as f64 * AUDIO_BUFFER_MAX_SECONDS).round() as usize;

    while shared.total_samples > max_samples && shared.chunks.len() > 1 {
        if let Some(removed) = shared.chunks.pop_front() {
            shared.total_samples = shared.total_samples.saturating_sub(removed.samples.len());
        }
    }
}

fn native_audio_chunk_reaches(chunk: &NativeAudioChunk, started_at: Instant) -> bool {
    chunk.timestamp + Duration::from_secs_f64(chunk.duration_ms / 1000.0) >= started_at
}

fn process_native_audio_samples(
    app: &AppHandle,
    device_id: &str,
    shared: &Arc<StdMutex<NativeAudioShared>>,
    samples: Vec<f32>,
) {
    if samples.is_empty() {
        return;
    }

    let mut realtime_audio = None;
    let mut realtime_audio_tx = None;
    let stats = {
        let mut shared = match shared.lock() {
            Ok(shared) => shared,
            Err(_) => return,
        };
        let now = Instant::now();
        let (rms, peak) = native_audio_stats(&samples);
        let duration_ms = (samples.len() as f64 / shared.sample_rate as f64) * 1000.0;

        if shared.capture_started_at.is_some() {
            realtime_audio_tx = shared.realtime_audio_tx.clone();
            if realtime_audio_tx.is_some() {
                realtime_audio = Some(encode_linear16_audio(&samples));
            }
        }

        shared.input_chunk_count += 1;
        shared.chunks.push_back(NativeAudioChunk {
            duration_ms,
            samples,
            timestamp: now,
        });
        shared.total_samples += shared.chunks.back().map(|chunk| chunk.samples.len()).unwrap_or(0);
        native_audio_trim(&mut shared);

        if shared.capture_started_at.is_some() {
            shared.capture_chunk_count += 1;
            shared.capture_input_ms += duration_ms;
            shared.capture_peak = shared.capture_peak.max(peak);
            shared.capture_rms = shared.capture_rms.max(rms);
        }

        if now.duration_since(shared.last_stats_at) < Duration::from_millis(AUDIO_STATS_INTERVAL_MS)
        {
            None
        } else {
            shared.last_stats_at = now;
            Some(AudioInputStats {
                device_id: device_id.to_string(),
                rms,
                peak,
                buffer_ms: ((shared.total_samples as f64 / shared.sample_rate as f64) * 1000.0)
                    .round() as u64,
            })
        }
    };

    if let Some(stats) = stats {
        let _ = app.emit(AUDIO_INPUT_STATS_EVENT, stats);
    }

    if let (Some(audio_tx), Some(audio_bytes)) = (realtime_audio_tx, realtime_audio) {
        let _ = audio_tx.send(audio_bytes);
    }
}

fn log_native_audio_stream_error(device_id: &str, error: cpal::StreamError) {
    log_whisper_local_audio_event(
        "audio.stream.error",
        None,
        json!({
            "device_id": device_id,
            "error": clean_whisper_local_audio_log_text(&error.to_string()),
        }),
    );
    eprintln!("Diff Forge audio input stream error for {device_id}: {error}");
}

fn build_native_audio_stream(
    app: AppHandle,
    device_id: String,
    device: &cpal::Device,
    supported_config: &cpal::SupportedStreamConfig,
    shared: Arc<StdMutex<NativeAudioShared>>,
) -> Result<cpal::Stream, String> {
    let stream_config: cpal::StreamConfig = supported_config.clone().into();
    let channels = stream_config.channels as usize;

    match supported_config.sample_format() {
        cpal::SampleFormat::F32 => {
            let callback_app = app.clone();
            let callback_device_id = device_id.clone();
            let callback_shared = shared.clone();
            let error_device_id = device_id.clone();
            device.build_input_stream(
                &stream_config,
                move |data: &[f32], _| {
                    process_native_audio_samples(
                        &callback_app,
                        &callback_device_id,
                        &callback_shared,
                        native_audio_mono_samples(data, channels, |sample| *sample),
                    );
                },
                move |error| log_native_audio_stream_error(&error_device_id, error),
                None,
            )
        }
        cpal::SampleFormat::F64 => {
            let callback_app = app.clone();
            let callback_device_id = device_id.clone();
            let callback_shared = shared.clone();
            let error_device_id = device_id.clone();
            device.build_input_stream(
                &stream_config,
                move |data: &[f64], _| {
                    process_native_audio_samples(
                        &callback_app,
                        &callback_device_id,
                        &callback_shared,
                        native_audio_mono_samples(data, channels, |sample| *sample as f32),
                    );
                },
                move |error| log_native_audio_stream_error(&error_device_id, error),
                None,
            )
        }
        cpal::SampleFormat::I16 => {
            let callback_app = app.clone();
            let callback_device_id = device_id.clone();
            let callback_shared = shared.clone();
            let error_device_id = device_id.clone();
            device.build_input_stream(
                &stream_config,
                move |data: &[i16], _| {
                    process_native_audio_samples(
                        &callback_app,
                        &callback_device_id,
                        &callback_shared,
                        native_audio_mono_samples(data, channels, |sample| {
                            *sample as f32 / i16::MAX as f32
                        }),
                    );
                },
                move |error| log_native_audio_stream_error(&error_device_id, error),
                None,
            )
        }
        cpal::SampleFormat::U16 => {
            let callback_app = app.clone();
            let callback_device_id = device_id.clone();
            let callback_shared = shared.clone();
            let error_device_id = device_id.clone();
            device.build_input_stream(
                &stream_config,
                move |data: &[u16], _| {
                    process_native_audio_samples(
                        &callback_app,
                        &callback_device_id,
                        &callback_shared,
                        native_audio_mono_samples(data, channels, |sample| {
                            ((*sample as f32) - 32768.0) / 32768.0
                        }),
                    );
                },
                move |error| log_native_audio_stream_error(&error_device_id, error),
                None,
            )
        }
        cpal::SampleFormat::I32 => {
            let callback_app = app.clone();
            let callback_device_id = device_id.clone();
            let callback_shared = shared.clone();
            let error_device_id = device_id.clone();
            device.build_input_stream(
                &stream_config,
                move |data: &[i32], _| {
                    process_native_audio_samples(
                        &callback_app,
                        &callback_device_id,
                        &callback_shared,
                        native_audio_mono_samples(data, channels, |sample| {
                            *sample as f32 / i32::MAX as f32
                        }),
                    );
                },
                move |error| log_native_audio_stream_error(&error_device_id, error),
                None,
            )
        }
        cpal::SampleFormat::U32 => {
            let callback_app = app.clone();
            let callback_device_id = device_id.clone();
            let callback_shared = shared.clone();
            let error_device_id = device_id.clone();
            device.build_input_stream(
                &stream_config,
                move |data: &[u32], _| {
                    process_native_audio_samples(
                        &callback_app,
                        &callback_device_id,
                        &callback_shared,
                        native_audio_mono_samples(data, channels, |sample| {
                            ((*sample as f64 - 2_147_483_648.0) / 2_147_483_648.0) as f32
                        }),
                    );
                },
                move |error| log_native_audio_stream_error(&error_device_id, error),
                None,
            )
        }
        sample_format => {
            return Err(format!(
                "Audio input sample format {sample_format:?} is not supported yet."
            ))
        }
    }
    .map_err(|error| native_audio_error_message(error))
}

fn resample_whisper_audio_to_16khz(samples: &[f32], source_rate: u32) -> Result<Vec<f32>, String> {
    if samples.is_empty() {
        return Ok(Vec::new());
    }

    if source_rate == 0 {
        return Err("Audio input sample rate is unavailable.".to_string());
    }

    if source_rate == AUDIO_TARGET_SAMPLE_RATE {
        return Ok(samples.to_vec());
    }

    let output_len = ((samples.len() as u64 * AUDIO_TARGET_SAMPLE_RATE as u64
        + (source_rate as u64 / 2))
        / source_rate as u64)
        .max(1) as usize;
    let source_step = source_rate as f64 / AUDIO_TARGET_SAMPLE_RATE as f64;
    let mut output = Vec::with_capacity(output_len);

    for index in 0..output_len {
        let source_position = index as f64 * source_step;
        let left_index = (source_position.floor() as usize).min(samples.len() - 1);
        let right_index = (left_index + 1).min(samples.len() - 1);
        let blend = (source_position - left_index as f64) as f32;
        let left = samples[left_index];
        let right = samples[right_index];
        output.push(left + ((right - left) * blend));
    }

    Ok(output)
}

fn encode_native_wav(samples: &[f32], sample_rate: u32) -> Vec<u8> {
    let bytes_per_sample = 2u16;
    let data_len = samples.len() as u32 * bytes_per_sample as u32;
    let mut bytes = Vec::with_capacity(44 + data_len as usize);

    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
    bytes.extend_from_slice(b"WAVE");
    bytes.extend_from_slice(b"fmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&sample_rate.to_le_bytes());
    bytes.extend_from_slice(&(sample_rate * bytes_per_sample as u32).to_le_bytes());
    bytes.extend_from_slice(&bytes_per_sample.to_le_bytes());
    bytes.extend_from_slice(&(bytes_per_sample * 8).to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_len.to_le_bytes());

    for sample in samples {
        let clipped = sample.clamp(-1.0, 1.0);
        let value = if clipped < 0.0 {
            (clipped * 32768.0) as i16
        } else {
            (clipped * 32767.0) as i16
        };
        bytes.extend_from_slice(&value.to_le_bytes());
    }

    bytes
}

fn finish_native_whisper_audio_capture(
    shared: &mut NativeAudioShared,
) -> Result<(Vec<u8>, u64), String> {
    let started_at = Instant::now();
    let capture_started_at = shared
        .capture_started_at
        .take()
        .ok_or_else(|| "Recorder is not armed.".to_string())?;
    let candidates = shared
        .chunks
        .iter()
        .filter(|chunk| native_audio_chunk_reaches(chunk, capture_started_at))
        .collect::<Vec<_>>();
    let candidate_chunks = candidates.len();
    let capture_chunk_count = shared.capture_chunk_count;
    let capture_input_ms = shared.capture_input_ms;
    let capture_peak = shared.capture_peak;
    let capture_rms = shared.capture_rms;

    shared.capture_chunk_count = 0;
    shared.capture_input_ms = 0.0;
    shared.capture_peak = 0.0;
    shared.capture_rms = 0.0;

    let captured_samples = candidates
        .into_iter()
        .flat_map(|chunk| chunk.samples.iter().copied())
        .collect::<Vec<_>>();

    if captured_samples.is_empty() {
        return Err("No audio captured.".to_string());
    }

    let max_samples = (shared.sample_rate as f64 * 90.0).round() as usize;
    let bounded_samples = if captured_samples.len() > max_samples {
        captured_samples[captured_samples.len() - max_samples..].to_vec()
    } else {
        captured_samples
    };
    let audio_ms = ((bounded_samples.len() as f64 / shared.sample_rate as f64) * 1000.0).round() as u64;
    let resample_started_at = Instant::now();
    let resampled = match resample_whisper_audio_to_16khz(&bounded_samples, shared.sample_rate) {
        Ok(samples) => samples,
        Err(error) => {
            log_whisper_local_audio_event(
                "audio.resample.error",
                Some(resample_started_at.elapsed()),
                json!({
                    "sample_rate": shared.sample_rate,
                    "target_sample_rate": AUDIO_TARGET_SAMPLE_RATE,
                    "input_samples": bounded_samples.len(),
                    "error": clean_whisper_local_audio_log_text(&error),
                }),
            );
            return Err(error);
        }
    };
    let resample_elapsed = resample_started_at.elapsed();
    let wav_bytes = encode_native_wav(&resampled, AUDIO_TARGET_SAMPLE_RATE);

    log_whisper_local_audio_event(
        "audio.capture.prepare.done",
        Some(started_at.elapsed()),
        json!({
            "sample_rate": shared.sample_rate,
            "target_sample_rate": AUDIO_TARGET_SAMPLE_RATE,
            "candidate_chunks": candidate_chunks,
            "capture_chunk_count": capture_chunk_count,
            "capture_input_ms": capture_input_ms,
            "capture_peak": capture_peak,
            "capture_rms": capture_rms,
            "audio_ms": audio_ms,
            "captured_samples": bounded_samples.len(),
            "resampled_samples": resampled.len(),
            "resample_elapsed_ms": resample_elapsed.as_secs_f64() * 1000.0,
            "wav_bytes": wav_bytes.len(),
        }),
    );

    Ok((wav_bytes, audio_ms))
}

fn native_audio_status(session: &NativeAudioSession) -> AudioInputMonitorStatus {
    AudioInputMonitorStatus {
        monitoring: true,
        device_id: session.device_id.clone(),
        label: session.label.clone(),
        sample_rate: session.sample_rate,
        owner_count: session.owners.len(),
    }
}

fn attach_native_audio_realtime_stream(
    session: Option<&NativeAudioSession>,
    audio_tx: mpsc::UnboundedSender<Vec<u8>>,
) -> Result<AudioInputMonitorStatus, String> {
    let active_session = session
        .ok_or_else(|| "Enable an input source before starting cloud transcription.".to_string())?;
    let mut shared = active_session
        .shared
        .lock()
        .map_err(|_| "Unable to lock native audio input buffer.".to_string())?;
    shared.realtime_audio_tx = Some(audio_tx);

    Ok(native_audio_status(active_session))
}

fn detach_native_audio_realtime_stream(session: Option<&NativeAudioSession>) -> Result<(), String> {
    if let Some(active_session) = session {
        let mut shared = active_session
            .shared
            .lock()
            .map_err(|_| "Unable to lock native audio input buffer.".to_string())?;
        shared.realtime_audio_tx = None;
    }

    Ok(())
}

fn start_native_audio_session(
    session: &mut Option<NativeAudioSession>,
    app: AppHandle,
    request: AudioInputMonitorRequest,
) -> Result<AudioInputMonitorStatus, String> {
    let started_at = Instant::now();
    let owner = audio_owner_label(request.owner);
    let requested_device_id = request.device_id.unwrap_or_else(|| "default".to_string());

    log_whisper_local_audio_event(
        "audio.monitor.start.request",
        None,
        json!({
            "owner": owner,
            "requested_device_id": requested_device_id,
            "had_active_session": session.is_some(),
        }),
    );

    if let Some(active_session) = session.as_mut() {
        if active_session.device_id == requested_device_id {
            active_session.owners.insert(owner.clone());
            let status = native_audio_status(active_session);
            log_whisper_local_audio_event(
                "audio.monitor.start.reused",
                Some(started_at.elapsed()),
                json!({
                    "owner": owner,
                    "device_id": &status.device_id,
                    "label": &status.label,
                    "sample_rate": status.sample_rate,
                    "owner_count": status.owner_count,
                }),
            );
            return Ok(status);
        }
    }

    *session = None;
    let (device, device_id, label) = cpal_input_device_by_id(&requested_device_id)?;
    let supported_config = device
        .default_input_config()
        .map_err(|error| native_audio_error_message(error))?;
    let sample_rate = supported_config.sample_rate().0;
    let sample_format = format!("{:?}", supported_config.sample_format());
    let channels = supported_config.channels();
    let shared = Arc::new(StdMutex::new(NativeAudioShared::new(sample_rate)));
    let stream = build_native_audio_stream(
        app,
        device_id.clone(),
        &device,
        &supported_config,
        shared.clone(),
    )?;

    stream
        .play()
        .map_err(|error| native_audio_error_message(error))?;

    let mut owners = HashSet::new();
    owners.insert(owner.clone());
    let next_session = NativeAudioSession {
        device_id,
        label,
        owners,
        sample_rate,
        shared,
        _stream: stream,
    };
    let status = native_audio_status(&next_session);
    *session = Some(next_session);

    log_whisper_local_audio_event(
        "audio.monitor.start.done",
        Some(started_at.elapsed()),
        json!({
            "owner": owner,
            "device_id": &status.device_id,
            "label": &status.label,
            "sample_rate": status.sample_rate,
            "sample_format": sample_format,
            "channels": channels,
            "owner_count": status.owner_count,
        }),
    );

    Ok(status)
}

fn stop_native_audio_session(
    session: &mut Option<NativeAudioSession>,
    request: Option<AudioInputMonitorRequest>,
) -> Result<AudioInputMonitorStatus, String> {
    let started_at = Instant::now();
    let Some(active_session) = session.as_mut() else {
        log_whisper_local_audio_event(
            "audio.monitor.stop.inactive",
            Some(started_at.elapsed()),
            json!({}),
        );
        return Ok(inactive_native_audio_status());
    };

    if let Some(owner) = request.and_then(|request| request.owner) {
        let owner = audio_owner_label(Some(owner));
        active_session.owners.remove(&owner);
        log_whisper_local_audio_event(
            "audio.monitor.stop.request",
            None,
            json!({
                "owner": owner,
                "device_id": &active_session.device_id,
                "owner_count_before_release": active_session.owners.len() + 1,
            }),
        );
    } else {
        log_whisper_local_audio_event(
            "audio.monitor.stop.request",
            None,
            json!({
                "owner": null,
                "device_id": &active_session.device_id,
                "owner_count_before_release": active_session.owners.len(),
            }),
        );
        active_session.owners.clear();
    }

    if active_session.owners.is_empty() {
        let device_id = active_session.device_id.clone();
        let label = active_session.label.clone();
        let sample_rate = active_session.sample_rate;
        *session = None;
        log_whisper_local_audio_event(
            "audio.monitor.stop.done",
            Some(started_at.elapsed()),
            json!({
                "device_id": device_id,
                "label": label,
                "sample_rate": sample_rate,
                "released_stream": true,
                "owner_count": 0,
            }),
        );
        return Ok(inactive_native_audio_status());
    }

    let status = native_audio_status(active_session);
    log_whisper_local_audio_event(
        "audio.monitor.stop.done",
        Some(started_at.elapsed()),
        json!({
            "device_id": &status.device_id,
            "label": &status.label,
            "sample_rate": status.sample_rate,
            "released_stream": false,
            "owner_count": status.owner_count,
        }),
    );

    Ok(status)
}

fn begin_native_audio_capture_for_session(
    session: Option<&NativeAudioSession>,
) -> Result<(), String> {
    let started_at = Instant::now();
    let session = session
        .ok_or_else(|| "Choose and enable a microphone in the Audio tab before recording.".to_string())?;
    let mut shared = session
        .shared
        .lock()
        .map_err(|_| "Unable to lock native audio input buffer.".to_string())?;
    let now = Instant::now();
    let capture_started_at = now
        .checked_sub(Duration::from_millis(AUDIO_CAPTURE_PREROLL_MS))
        .unwrap_or(now);
    let buffered_ms = ((shared.total_samples as f64 / shared.sample_rate as f64) * 1000.0)
        .round() as u64;
    let realtime_audio_tx = shared.realtime_audio_tx.clone();
    let mut preroll_audio = Vec::new();
    let mut preroll_chunk_count = 0u64;
    let mut preroll_input_ms = 0.0f64;
    let mut preroll_peak = 0.0f32;
    let mut preroll_rms = 0.0f32;

    for chunk in shared
        .chunks
        .iter()
        .filter(|chunk| native_audio_chunk_reaches(chunk, capture_started_at))
    {
        let (chunk_rms, chunk_peak) = native_audio_stats(&chunk.samples);

        preroll_chunk_count += 1;
        preroll_input_ms += chunk.duration_ms;
        preroll_peak = preroll_peak.max(chunk_peak);
        preroll_rms = preroll_rms.max(chunk_rms);

        if realtime_audio_tx.is_some() {
            preroll_audio.push(encode_linear16_audio(&chunk.samples));
        }
    }

    shared.capture_started_at = Some(capture_started_at);
    shared.capture_chunk_count = preroll_chunk_count;
    shared.capture_input_ms = preroll_input_ms;
    shared.capture_peak = preroll_peak;
    shared.capture_rms = preroll_rms;
    let buffer_chunks = shared.chunks.len();
    drop(shared);

    if let Some(audio_tx) = realtime_audio_tx {
        for audio_bytes in preroll_audio {
            let _ = audio_tx.send(audio_bytes);
        }
    }

    log_whisper_local_audio_event(
        "audio.capture.begin",
        Some(started_at.elapsed()),
        json!({
            "device_id": &session.device_id,
            "label": &session.label,
            "sample_rate": session.sample_rate,
            "owner_count": session.owners.len(),
            "buffered_ms": buffered_ms,
            "buffer_chunks": buffer_chunks,
            "preroll_ms": AUDIO_CAPTURE_PREROLL_MS,
            "preroll_input_ms": preroll_input_ms,
            "preroll_chunks": preroll_chunk_count,
        }),
    );

    Ok(())
}

fn finish_native_audio_capture_for_session(
    session: Option<&NativeAudioSession>,
) -> Result<AudioInputCaptureResult, String> {
    let started_at = Instant::now();
    let session = session
        .ok_or_else(|| "Choose and enable a microphone in the Audio tab before recording.".to_string())?;
    let mut shared = session
        .shared
        .lock()
        .map_err(|_| "Unable to lock native audio input buffer.".to_string())?;
    let (wav_bytes, audio_ms) = match finish_native_whisper_audio_capture(&mut shared) {
        Ok(result) => result,
        Err(error) => {
            log_whisper_local_audio_event(
                "audio.capture.finish.error",
                Some(started_at.elapsed()),
                json!({
                    "device_id": &session.device_id,
                    "label": &session.label,
                    "sample_rate": session.sample_rate,
                    "owner_count": session.owners.len(),
                    "error": clean_whisper_local_audio_log_text(&error),
                }),
            );
            return Err(error);
        }
    };
    let audio_bytes = wav_bytes.len();

    log_whisper_local_audio_event(
        "audio.capture.finish",
        Some(started_at.elapsed()),
        json!({
            "device_id": &session.device_id,
            "label": &session.label,
            "sample_rate": session.sample_rate,
            "owner_count": session.owners.len(),
            "audio_bytes": audio_bytes,
            "audio_ms": audio_ms,
        }),
    );

    Ok(AudioInputCaptureResult {
        audio_base64: general_purpose::STANDARD.encode(wav_bytes),
        audio_ms,
    })
}

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

fn find_named_whisper_runtime_executable(directory: &Path, runtime_name: &str) -> Option<PathBuf> {
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

            if runtime_name.eq_ignore_ascii_case(name) {
                return Some(path);
            }
        }
    }

    None
}

fn find_whisper_runtime_executable(directory: &Path) -> Option<PathBuf> {
    whisper_runtime_executable_names()
        .iter()
        .find_map(|runtime_name| find_named_whisper_runtime_executable(directory, runtime_name))
}

fn whisper_runtime_executable_path(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    if let Some(runtime) = find_whisper_runtime_executable(&whisper_runtime_directory(app)?) {
        return Ok(Some(runtime));
    }

    Ok(external_whisper_runtime_executable_path())
}

fn external_whisper_runtime_executable_path() -> Option<PathBuf> {
    if let Some(runtime) = find_executable_on_path(whisper_runtime_executable_names()) {
        return Some(runtime);
    }

    common_whisper_runtime_paths()
        .into_iter()
        .find(|candidate| candidate.is_file())
}

fn whisper_model_status_for(app: &AppHandle) -> Result<WhisperModelStatus, String> {
    let model_path = whisper_model_path(app)?;
    let runtime_directory = whisper_runtime_directory(app)?;
    let runtime_zip_path = whisper_runtime_zip_path(app)?;
    let managed_runtime_path = find_whisper_runtime_executable(&runtime_directory);
    let runtime_path = managed_runtime_path
        .clone()
        .or_else(external_whisper_runtime_executable_path);
    let bytes = fs::metadata(&model_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let model_installed = bytes > 0;
    let runtime_installed = runtime_path.is_some();
    let managed_runtime_installed = managed_runtime_path.is_some();
    let managed_assets_installed =
        model_installed || managed_runtime_installed || runtime_directory.exists() || runtime_zip_path.exists();

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
                runtime_directory.display().to_string()
            }),
        runtime_installable: WHISPER_RUNTIME_URL.is_some(),
        managed_runtime_installed,
        managed_assets_installed,
        runtime_install_hint: WHISPER_RUNTIME_INSTALL_HINT,
        download_url: WHISPER_MODEL_URL,
        expected_sha1: WHISPER_MODEL_SHA1,
        approximate_disk_mb: WHISPER_MODEL_DISK_MB,
        approximate_memory_mb: WHISPER_MODEL_MEMORY_MB,
        bytes,
        shortcut: audio_push_to_talk_shortcut_for(app),
        shortcuts: audio_shortcuts_status_for(app),
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

fn is_whisper_runtime_warning_line(line: &str) -> bool {
    let lowercase = line.trim().to_lowercase();

    lowercase.contains("the binary 'main.exe' is deprecated")
        || lowercase.contains("the binary \"main.exe\" is deprecated")
        || lowercase.contains("the binary 'main' is deprecated")
        || lowercase.contains("the binary \"main\" is deprecated")
        || lowercase.contains("deprecation-warning")
}

fn normalize_transcript_text(text: &str) -> String {
    text.lines()
        .filter(|line| !is_whisper_runtime_warning_line(line))
        .collect::<Vec<_>>()
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
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

fn clean_deepgram_api_key(value: &str) -> Result<String, String> {
    let api_key = value.trim();

    if api_key.is_empty() {
        return Err("Add a Deepgram API key before recording in cloud mode.".to_string());
    }

    if api_key.len() > DEEPGRAM_MAX_API_KEY_LENGTH || api_key.chars().any(char::is_control) {
        return Err("Deepgram API key is not valid.".to_string());
    }

    Ok(api_key.to_string())
}

fn clean_deepgram_language(value: Option<String>) -> Result<String, String> {
    let language = value
        .unwrap_or_else(|| DEEPGRAM_DEFAULT_LANGUAGE.to_string())
        .trim()
        .to_string();

    if language.is_empty() {
        return Ok(DEEPGRAM_DEFAULT_LANGUAGE.to_string());
    }

    if language.len() > DEEPGRAM_MAX_LANGUAGE_LENGTH
        || !language
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err("Deepgram language must be a supported language code.".to_string());
    }

    Ok(language)
}

fn clean_deepgram_transcript_text(value: &str) -> Result<String, String> {
    let cleaned = value
        .chars()
        .filter(|character| !character.is_control() || matches!(character, '\n' | '\r' | '\t'))
        .collect::<String>()
        .trim()
        .to_string();

    if cleaned.is_empty() {
        return Err("Deepgram did not produce any text to insert.".to_string());
    }

    if cleaned.chars().count() > MAX_AUDIO_TRANSCRIPT_INSERT_CHARS {
        return Err(format!(
            "Transcripts are limited to {MAX_AUDIO_TRANSCRIPT_INSERT_CHARS} characters."
        ));
    }

    Ok(cleaned)
}

fn deepgram_realtime_url(language: &str, sample_rate: u32) -> String {
    format!(
        "{DEEPGRAM_LISTEN_WS_URL}?model={DEEPGRAM_MODEL}&language={language}&encoding=linear16&sample_rate={sample_rate}&channels=1&interim_results=true&smart_format=true"
    )
}

fn deepgram_error_from_body(body: &Value) -> Option<String> {
    body
        .get("err_msg")
        .or_else(|| body.get("message"))
        .or_else(|| body.get("error"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn handle_deepgram_realtime_text(
    app: &AppHandle,
    text: &str,
    final_segments: &mut Vec<String>,
    latest_interim: &mut String,
) -> Result<(), String> {
    let body = serde_json::from_str::<Value>(text)
        .map_err(|error| format!("Deepgram realtime stream returned invalid JSON: {error}"))?;
    let message_type = body.get("type").and_then(Value::as_str).unwrap_or("");

    if message_type == "Error" {
        return Err(deepgram_error_from_body(&body)
            .unwrap_or_else(|| "Deepgram realtime transcription failed.".to_string()));
    }

    let transcript = body
        .pointer("/channel/alternatives/0/transcript")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();

    if transcript.is_empty() {
        return Ok(());
    }

    let is_final = body
        .get("is_final")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let speech_final = body
        .get("speech_final")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let event = DeepgramRealtimeTranscriptEvent {
        text: transcript.to_string(),
        is_final,
        speech_final,
    };

    if is_final {
        final_segments.push(transcript.to_string());
        latest_interim.clear();
    } else {
        *latest_interim = transcript.to_string();
    }

    let _ = app.emit(AUDIO_REALTIME_TRANSCRIPT_EVENT, event);

    Ok(())
}

fn handle_deepgram_realtime_message(
    app: &AppHandle,
    message: Message,
    final_segments: &mut Vec<String>,
    latest_interim: &mut String,
) -> Result<bool, String> {
    match message {
        Message::Text(text) => {
            handle_deepgram_realtime_text(app, text.as_ref(), final_segments, latest_interim)?;
            Ok(false)
        }
        Message::Binary(bytes) => {
            if let Ok(text) = std::str::from_utf8(&bytes) {
                handle_deepgram_realtime_text(app, text, final_segments, latest_interim)?;
            }
            Ok(false)
        }
        Message::Close(_) => Ok(true),
        _ => Ok(false),
    }
}

fn whisper_cli_thread_count() -> usize {
    std::thread::available_parallelism()
        .map(usize::from)
        .unwrap_or(4)
        .clamp(4, 8)
}

fn prepare_whisper_model_for(
    app: &AppHandle,
    warm_cache: &WhisperCliWarmCache,
) -> Result<WhisperWarmStatus, String> {
    let status = whisper_model_status_for(app)?;

    if !status.model_installed {
        return Err("Install the local Whisper model before opening the audio widget.".to_string());
    }

    if !status.runtime_installed {
        return Err(WHISPER_RUNTIME_INSTALL_HINT.to_string());
    }

    let model_path = whisper_model_path(app)?;
    warm_cache.prepare(&model_path)
}

fn transcribe_whisper_audio_for(
    app: &AppHandle,
    warm_cache: &WhisperCliWarmCache,
    request: WhisperTranscriptionRequest,
    cancel_token: Arc<AtomicU64>,
    cancel_generation: u64,
) -> Result<WhisperTranscriptionResult, String> {
    let started_at = Instant::now();
    let audio_base64_chars = request.audio_base64.len();
    log_whisper_local_audio_event(
        "whisper.transcribe.start",
        None,
        json!({
            "audio_base64_chars": audio_base64_chars,
            "max_audio_bytes": WHISPER_MAX_AUDIO_BYTES,
        }),
    );

    if cancel_token.load(Ordering::Acquire) != cancel_generation {
        return Err("Local Whisper transcription canceled.".to_string());
    }

    if request.audio_base64.len() > WHISPER_MAX_AUDIO_BYTES * 2 {
        log_whisper_local_audio_event(
            "whisper.transcribe.reject",
            Some(started_at.elapsed()),
            json!({
                "reason": "base64_too_large",
                "audio_base64_chars": audio_base64_chars,
            }),
        );
        return Err("Recorded audio is too large to transcribe.".to_string());
    }

    let decode_started_at = Instant::now();
    let audio_bytes = match general_purpose::STANDARD.decode(request.audio_base64.trim()) {
        Ok(audio_bytes) => audio_bytes,
        Err(error) => {
            log_whisper_local_audio_event(
                "whisper.transcribe.decode.error",
                Some(decode_started_at.elapsed()),
                json!({
                    "audio_base64_chars": audio_base64_chars,
                    "error": clean_whisper_local_audio_log_text(&error.to_string()),
                }),
            );
            return Err(format!("Recorded audio is not valid base64: {error}"));
        }
    };
    log_whisper_local_audio_event(
        "whisper.transcribe.decode.done",
        Some(decode_started_at.elapsed()),
        json!({
            "audio_base64_chars": audio_base64_chars,
            "audio_bytes": audio_bytes.len(),
        }),
    );

    if audio_bytes.len() > WHISPER_MAX_AUDIO_BYTES {
        log_whisper_local_audio_event(
            "whisper.transcribe.reject",
            Some(started_at.elapsed()),
            json!({
                "reason": "audio_too_large",
                "audio_bytes": audio_bytes.len(),
            }),
        );
        return Err("Recorded audio is too large to transcribe.".to_string());
    }

    let model_path = whisper_model_path(app)?;

    if !model_path.exists() {
        return Err("Install the local Whisper model before recording.".to_string());
    }

    let runtime_path = whisper_runtime_executable_path(app)?
        .ok_or_else(|| "Install the local Whisper runtime before recording.".to_string())?;
    let warm_started_at = Instant::now();
    let warm_status = warm_cache.prepare(&model_path)?;
    log_whisper_local_audio_event(
        "whisper.transcribe.cache_warm.done",
        Some(warm_started_at.elapsed()),
        json!({
            "cached": warm_status.cached,
            "warmed_bytes": warm_status.warmed_bytes,
            "model_path": warm_status.model_path,
        }),
    );
    let temp_directory = whisper_model_directory(app)?.join("recordings");
    fs::create_dir_all(&temp_directory)
        .map_err(|error| format!("Unable to prepare audio recording directory: {error}"))?;

    let recording_id = current_time_ms();
    let audio_path = temp_directory.join(format!("recording-{recording_id}.wav"));

    let write_started_at = Instant::now();
    fs::write(&audio_path, &audio_bytes)
        .map_err(|error| format!("Unable to prepare microphone audio: {error}"))?;
    log_whisper_local_audio_event(
        "whisper.transcribe.temp_wav.done",
        Some(write_started_at.elapsed()),
        json!({
            "audio_bytes": audio_bytes.len(),
            "audio_path": audio_path.display().to_string(),
        }),
    );

    let runtime = runtime_path.display().to_string();
    let model = model_path.display().to_string();
    let audio = audio_path.display().to_string();
    let thread_count = whisper_cli_thread_count().to_string();
    let args = vec![
        "-m".to_string(),
        model.clone(),
        "-f".to_string(),
        audio.clone(),
        "-l".to_string(),
        "en".to_string(),
        "-t".to_string(),
        thread_count.clone(),
        "-nt".to_string(),
        "-np".to_string(),
        "-bo".to_string(),
        "1".to_string(),
        "-bs".to_string(),
        "1".to_string(),
        "-nf".to_string(),
    ];
    let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    let cli_started_at = Instant::now();
    log_whisper_local_audio_event(
        "whisper.cli.start",
        None,
        json!({
            "runtime_path": &runtime,
            "model_path": &model,
            "audio_bytes": audio_bytes.len(),
            "audio_path": &audio,
            "threads": &thread_count,
            "best_of": 1,
            "beam_size": 1,
            "no_fallback": true,
            "output_mode": "stdout",
            "timeout_secs": WHISPER_TRANSCRIBE_TIMEOUT_SECS,
        }),
    );
    let cancel_token_for_command = Arc::clone(&cancel_token);
    let capture_result = run_command_capture_with_cancel(
        &runtime,
        &arg_refs,
        None,
        Duration::from_secs(WHISPER_TRANSCRIBE_TIMEOUT_SECS),
        None,
        move || cancel_token_for_command.load(Ordering::Acquire) != cancel_generation,
        "Local Whisper transcription canceled.",
    );
    let capture = match capture_result {
        Ok(capture) => {
            log_whisper_local_audio_event(
                "whisper.cli.done",
                Some(cli_started_at.elapsed()),
                json!({
                    "exit_code": capture.exit_code,
                    "stdout_bytes": capture.stdout.len(),
                    "stderr_bytes": capture.stderr.len(),
                }),
            );
            capture
        }
        Err(error) => {
            let _ = fs::remove_file(&audio_path);
            log_whisper_local_audio_event(
                "whisper.cli.error",
                Some(cli_started_at.elapsed()),
                json!({
                    "error": clean_whisper_local_audio_log_text(&error),
                    "audio_path_removed": true,
                }),
            );
            return Err(error);
        }
    };

    let read_started_at = Instant::now();
    let transcript = command_output_text(&capture.stdout, &capture.stderr);
    let text = normalize_transcript_text(&transcript);
    let _ = fs::remove_file(&audio_path);
    log_whisper_local_audio_event(
        "whisper.transcribe.output_read.done",
        Some(read_started_at.elapsed()),
        json!({
            "raw_transcript_chars": transcript.chars().count(),
            "clean_text_chars": text.chars().count(),
            "used_transcript_file": false,
            "audio_path_removed": true,
        }),
    );

    if capture.exit_code != Some(0) && text.is_empty() {
        let error = first_output_line(&command_output_text(&capture.stdout, &capture.stderr))
                .chars()
                .take(240)
                .collect::<String>();
        log_whisper_local_audio_event(
            "whisper.transcribe.error",
            Some(started_at.elapsed()),
            json!({
                "exit_code": capture.exit_code,
                "error": clean_whisper_local_audio_log_text(&error),
                "stdout_bytes": capture.stdout.len(),
                "stderr_bytes": capture.stderr.len(),
            }),
        );
        return Err(error);
    }

    let segments = if transcript.trim().is_empty() { 0 } else { 1 };
    log_whisper_local_audio_event(
        "whisper.transcribe.done",
        Some(started_at.elapsed()),
        json!({
            "exit_code": capture.exit_code,
            "audio_bytes": audio_bytes.len(),
            "raw_transcript_chars": transcript.chars().count(),
            "clean_text_chars": text.chars().count(),
            "segments": segments,
        }),
    );

    Ok(WhisperTranscriptionResult {
        text,
        segments,
        duration_ms: started_at.elapsed().as_millis(),
    })
}

fn ensure_audio_widget_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(AUDIO_WIDGET_WINDOW_LABEL) {
        return Ok(window);
    }

    let window = WebviewWindowBuilder::new(
        app,
        AUDIO_WIDGET_WINDOW_LABEL,
        WebviewUrl::App("index.html#/audio-widget".into()),
    )
    .title("Diff Forge Audio")
    .inner_size(64.0, 64.0)
    .min_inner_size(56.0, 56.0)
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .focused(false)
    .transparent(true)
    .visible(false)
    .shadow(false)
    .build()
    .map_err(|error| format!("Unable to create audio widget: {error}"))?;

    let app_handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            emit_audio_widget_current_visibility(&app_handle, false);
        }
    });

    Ok(window)
}

fn audio_widget_visibility_for(
    app: &AppHandle,
    visible: bool,
) -> Result<AudioWidgetVisibility, String> {
    let status = whisper_model_status_for(app)?;

    Ok(AudioWidgetVisibility {
        visible,
        installed: status.installed,
        shortcut: status.shortcut,
    })
}

fn audio_widget_status_for(app: &AppHandle) -> Result<AudioWidgetVisibility, String> {
    let visible = app
        .get_webview_window(AUDIO_WIDGET_WINDOW_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);

    audio_widget_visibility_for(app, visible)
}

fn emit_audio_widget_visibility_changed(app: &AppHandle, visibility: &AudioWidgetVisibility) {
    let _ = app.emit(AUDIO_WIDGET_VISIBILITY_CHANGED_EVENT, visibility.clone());
}

fn emit_audio_widget_current_visibility(app: &AppHandle, visible: bool) {
    if let Ok(visibility) = audio_widget_visibility_for(app, visible) {
        emit_audio_widget_visibility_changed(app, &visibility);
    }
}

fn show_audio_widget_for(app: &AppHandle) -> Result<AudioWidgetVisibility, String> {
    let status = whisper_model_status_for(app)?;

    let window = ensure_audio_widget_window(app)?;
    window
        .show()
        .map_err(|error| format!("Unable to show audio widget: {error}"))?;
    let _ = window.set_focus();

    let visibility = AudioWidgetVisibility {
        visible: true,
        installed: status.installed,
        shortcut: audio_push_to_talk_shortcut_for(app),
    };
    emit_audio_widget_visibility_changed(app, &visibility);
    Ok(visibility)
}

fn hide_audio_widget_for(app: &AppHandle) -> Result<AudioWidgetVisibility, String> {
    if let Some(window) = app.get_webview_window(AUDIO_WIDGET_WINDOW_LABEL) {
        window
            .hide()
            .map_err(|error| format!("Unable to hide audio widget: {error}"))?;
    }

    let visibility = audio_widget_visibility_for(app, false)?;
    emit_audio_widget_visibility_changed(app, &visibility);
    Ok(visibility)
}

fn toggle_audio_widget_for(app: &AppHandle) -> Result<AudioWidgetVisibility, String> {
    if let Some(window) = app.get_webview_window(AUDIO_WIDGET_WINDOW_LABEL) {
        if window.is_visible().unwrap_or(false) {
            return hide_audio_widget_for(app);
        }
    }

    show_audio_widget_for(app)
}

#[tauri::command]
async fn whisper_model_status(app: AppHandle) -> Result<WhisperModelStatus, String> {
    whisper_model_status_for(&app)
}

#[tauri::command]
async fn audio_input_devices() -> Result<Vec<AudioInputDeviceSummary>, String> {
    audio_input_devices_for_host(&cpal_host())
}

#[tauri::command]
async fn start_audio_input_monitor(
    app: AppHandle,
    audio_state: State<'_, AudioState>,
    request: AudioInputMonitorRequest,
) -> Result<AudioInputMonitorStatus, String> {
    audio_state.input_worker.start_monitor(app, request)
}

#[tauri::command]
async fn stop_audio_input_monitor(
    audio_state: State<'_, AudioState>,
    request: Option<AudioInputMonitorRequest>,
) -> Result<AudioInputMonitorStatus, String> {
    audio_state.input_worker.stop_monitor(request)
}

#[tauri::command]
async fn begin_audio_input_capture(audio_state: State<'_, AudioState>) -> Result<(), String> {
    audio_state.input_worker.begin_capture()
}

#[tauri::command]
async fn finish_audio_input_capture(
    audio_state: State<'_, AudioState>,
) -> Result<AudioInputCaptureResult, String> {
    audio_state.input_worker.finish_capture()
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
async fn uninstall_whisper_model(
    app: AppHandle,
    audio_state: State<'_, AudioState>,
) -> Result<WhisperModelStatus, String> {
    let _download_guard = audio_state.download_lock.lock().await;
    let model_directory = whisper_model_directory(&app)?;
    audio_state.whisper_engine.clear();

    if let Some(window) = app.get_webview_window(AUDIO_WIDGET_WINDOW_LABEL) {
        let _ = window.hide();
        emit_audio_widget_current_visibility(&app, false);
    }

    match fs::remove_dir_all(&model_directory) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("Unable to uninstall Whisper: {error}")),
    }

    whisper_model_status_for(&app)
}

#[tauri::command]
async fn prepare_whisper_model(
    app: AppHandle,
    audio_state: State<'_, AudioState>,
) -> Result<WhisperWarmStatus, String> {
    let engine = audio_state.whisper_engine.clone();

    tauri::async_runtime::spawn_blocking(move || prepare_whisper_model_for(&app, &engine))
        .await
        .map_err(|error| format!("Unable to prepare local Whisper model: {error}"))?
}

#[tauri::command]
async fn transcribe_whisper_audio(
    app: AppHandle,
    audio_state: State<'_, AudioState>,
    request: WhisperTranscriptionRequest,
) -> Result<WhisperTranscriptionResult, String> {
    let engine = audio_state.whisper_engine.clone();
    let cancel_token = Arc::clone(&audio_state.whisper_cancel_token);
    let cancel_generation = cancel_token.load(Ordering::Acquire);

    tauri::async_runtime::spawn_blocking(move || {
        transcribe_whisper_audio_for(&app, &engine, request, cancel_token, cancel_generation)
    })
        .await
        .map_err(|error| format!("Unable to run local Whisper transcription: {error}"))?
}

#[tauri::command]
async fn cancel_whisper_transcription(audio_state: State<'_, AudioState>) -> Result<(), String> {
    audio_state
        .whisper_cancel_token
        .fetch_add(1, Ordering::AcqRel);
    Ok(())
}

async fn run_deepgram_realtime_stream(
    app: AppHandle,
    api_key: String,
    language: String,
    sample_rate: u32,
    mut audio_rx: mpsc::UnboundedReceiver<Vec<u8>>,
    ready_tx: oneshot::Sender<Result<(), String>>,
    finished_tx: oneshot::Sender<Result<WhisperTranscriptionResult, String>>,
) {
    let started_at = Instant::now();
    let mut request = match deepgram_realtime_url(&language, sample_rate).into_client_request() {
        Ok(request) => request,
        Err(error) => {
            let message = format!("Unable to prepare Deepgram realtime stream: {error}");
            let _ = ready_tx.send(Err(message.clone()));
            let _ = finished_tx.send(Err(message));
            return;
        }
    };
    let auth_header = match HeaderValue::from_str(&format!("Token {api_key}")) {
        Ok(header) => header,
        Err(error) => {
            let message = format!("Deepgram API key could not be sent: {error}");
            let _ = ready_tx.send(Err(message.clone()));
            let _ = finished_tx.send(Err(message));
            return;
        }
    };
    request.headers_mut().insert("Authorization", auth_header);

    let (ws_stream, _) = match connect_async(request).await {
        Ok(stream) => stream,
        Err(error) => {
            let message = format!("Unable to open Deepgram realtime WebSocket: {error}");
            let _ = ready_tx.send(Err(message.clone()));
            let _ = finished_tx.send(Err(message));
            return;
        }
    };
    let _ = ready_tx.send(Ok(()));

    let (mut write, mut read) = ws_stream.split();
    let mut final_segments = Vec::new();
    let mut latest_interim = String::new();
    let mut stream_error: Option<String> = None;

    loop {
        tokio::select! {
            maybe_audio = audio_rx.recv() => {
                let Some(audio_bytes) = maybe_audio else {
                    break;
                };

                if !audio_bytes.is_empty() {
                    if let Err(error) = write.send(Message::Binary(audio_bytes.into())).await {
                        stream_error = Some(format!("Unable to stream audio to Deepgram: {error}"));
                        break;
                    }
                }
            }
            maybe_message = read.next() => {
                match maybe_message {
                    Some(Ok(message)) => {
                        match handle_deepgram_realtime_message(&app, message, &mut final_segments, &mut latest_interim) {
                            Ok(true) => break,
                            Ok(false) => {}
                            Err(error) => {
                                stream_error = Some(error);
                                break;
                            }
                        }
                    }
                    Some(Err(error)) => {
                        stream_error = Some(format!("Deepgram realtime stream failed: {error}"));
                        break;
                    }
                    None => break,
                }
            }
        }
    }

    if stream_error.is_none() {
        let close_message = Message::Text("{\"type\":\"CloseStream\"}".into());
        if let Err(error) = write.send(close_message).await {
            stream_error = Some(format!("Unable to close Deepgram realtime stream: {error}"));
        }
    }

    if stream_error.is_none() {
        loop {
            match timeout(Duration::from_secs(DEEPGRAM_CLOSE_TIMEOUT_SECS), read.next()).await {
                Ok(Some(Ok(message))) => {
                    match handle_deepgram_realtime_message(&app, message, &mut final_segments, &mut latest_interim) {
                        Ok(true) => break,
                        Ok(false) => {}
                        Err(error) => {
                            stream_error = Some(error);
                            break;
                        }
                    }
                }
                Ok(Some(Err(error))) => {
                    stream_error = Some(format!("Deepgram realtime stream failed: {error}"));
                    break;
                }
                Ok(None) | Err(_) => break,
            }
        }
    }

    if let Some(error) = stream_error {
        let _ = finished_tx.send(Err(error));
        return;
    }

    let transcript = if final_segments.is_empty() {
        latest_interim
    } else {
        final_segments.join(" ")
    };
    let segments = if final_segments.is_empty() {
        if transcript.trim().is_empty() { 0 } else { 1 }
    } else {
        final_segments.len()
    };
    let text = if transcript.trim().is_empty() {
        String::new()
    } else {
        match clean_deepgram_transcript_text(&transcript) {
            Ok(text) => text,
            Err(error) => {
                let _ = finished_tx.send(Err(error));
                return;
            }
        }
    };
    let _ = finished_tx.send(Ok(WhisperTranscriptionResult {
        text,
        segments,
        duration_ms: started_at.elapsed().as_millis(),
    }));
}

#[tauri::command]
async fn start_deepgram_realtime_transcription(
    app: AppHandle,
    audio_state: State<'_, AudioState>,
    request: DeepgramRealtimeStartRequest,
) -> Result<DeepgramRealtimeStartStatus, String> {
    let api_key = clean_deepgram_api_key(&request.api_key)?;
    let language = clean_deepgram_language(request.language)?;
    let mut session_guard = audio_state.deepgram_stream.lock().await;

    if session_guard.is_some() {
        return Err("Deepgram realtime transcription is already active.".to_string());
    }

    let (audio_tx, audio_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let status = audio_state.input_worker.attach_realtime_stream(audio_tx)?;
    let (ready_tx, ready_rx) = oneshot::channel();
    let (finished_tx, finished_rx) = oneshot::channel();

    tauri::async_runtime::spawn(run_deepgram_realtime_stream(
        app,
        api_key,
        language.clone(),
        status.sample_rate,
        audio_rx,
        ready_tx,
        finished_tx,
    ));

    match timeout(Duration::from_secs(DEEPGRAM_CONNECT_TIMEOUT_SECS), ready_rx).await {
        Ok(Ok(Ok(()))) => {}
        Ok(Ok(Err(error))) => {
            let _ = audio_state.input_worker.detach_realtime_stream();
            return Err(error);
        }
        Ok(Err(_closed)) => {
            let _ = audio_state.input_worker.detach_realtime_stream();
            return Err("Deepgram realtime stream closed before it was ready.".to_string());
        }
        Err(_elapsed) => {
            let _ = audio_state.input_worker.detach_realtime_stream();
            return Err("Deepgram realtime stream timed out while connecting.".to_string());
        }
    }

    *session_guard = Some(DeepgramRealtimeSession { finished_rx });

    Ok(DeepgramRealtimeStartStatus {
        active: true,
        language,
        model: DEEPGRAM_MODEL,
        sample_rate: status.sample_rate,
    })
}

#[tauri::command]
async fn stop_deepgram_realtime_transcription(
    audio_state: State<'_, AudioState>,
) -> Result<WhisperTranscriptionResult, String> {
    let session = {
        let mut session_guard = audio_state.deepgram_stream.lock().await;
        session_guard.take()
    };
    let Some(session) = session else {
        return Ok(WhisperTranscriptionResult {
            text: String::new(),
            segments: 0,
            duration_ms: 0,
        });
    };

    audio_state.input_worker.detach_realtime_stream()?;

    timeout(
        Duration::from_secs(DEEPGRAM_TRANSCRIBE_TIMEOUT_SECS),
        session.finished_rx,
    )
    .await
    .map_err(|_| "Deepgram realtime transcription timed out.".to_string())?
    .map_err(|_| "Deepgram realtime transcription stopped before a result was returned.".to_string())?
}

#[tauri::command]
async fn audio_widget_status(app: AppHandle) -> Result<AudioWidgetVisibility, String> {
    audio_widget_status_for(&app)
}

#[tauri::command]
async fn show_audio_widget(
    app: AppHandle,
    audio_state: State<'_, AudioState>,
) -> Result<AudioWidgetVisibility, String> {
    let visibility = show_audio_widget_for(&app)?;
    let prepare_app = app.clone();
    let engine = audio_state.whisper_engine.clone();

    if visibility.installed {
        let _ = tauri::async_runtime::spawn_blocking(move || {
            let _ = prepare_whisper_model_for(&prepare_app, &engine);
        });
    }

    Ok(visibility)
}

#[tauri::command]
async fn hide_audio_widget(app: AppHandle) -> Result<AudioWidgetVisibility, String> {
    hide_audio_widget_for(&app)
}

#[tauri::command]
async fn toggle_audio_widget(
    app: AppHandle,
    audio_state: State<'_, AudioState>,
) -> Result<AudioWidgetVisibility, String> {
    let visibility = toggle_audio_widget_for(&app)?;

    if visibility.visible && visibility.installed {
        let prepare_app = app.clone();
        let engine = audio_state.whisper_engine.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || {
            let _ = prepare_whisper_model_for(&prepare_app, &engine);
        });
    }

    Ok(visibility)
}

#[tauri::command]
async fn insert_transcribed_text(
    app: AppHandle,
    text: String,
) -> Result<AudioWidgetVisibility, String> {
    let text = clean_transcript_for_insert(text)?;
    let widget_visible = app
        .get_webview_window(AUDIO_WIDGET_WINDOW_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);

    let insert_result = tauri::async_runtime::spawn_blocking(move || {
        thread::sleep(Duration::from_millis(220));
        insert_text_with_enigo(&text)
    })
    .await
    .map_err(|error| format!("Unable to insert transcript: {error}"))?;

    if let Err(error) = insert_result {
        return Err(error);
    }

    Ok(AudioWidgetVisibility {
        visible: widget_visible,
        installed: whisper_model_status_for(&app)?.installed,
        shortcut: audio_push_to_talk_shortcut_for(&app),
    })
}

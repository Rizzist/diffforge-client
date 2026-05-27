use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

const CLOUD_VOICE_AGENT_TTS_SUPPRESSION_TAIL_MS: u64 = 2_500;
const CLOUD_VOICE_AGENT_TTS_SUPPRESSION_MAX_MS: u64 = 30_000;
const CLOUD_VOICE_AGENT_FAST_RESPONSE_HOLD_MS: u64 = 0;

fn whisper_local_audio_log_path() -> PathBuf {
    diagnostic_log_path(WHISPER_LOCAL_AUDIO_LOG_FILE)
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

fn audio_debug_thread_label() -> String {
    let current_thread = thread::current();
    let name = current_thread.name().unwrap_or("unnamed");

    format!("{:?}:{name}", current_thread.id())
}

fn log_audio_diagnostic_event(phase: &str, fields: Value) {
    log_whisper_local_audio_event(
        phase,
        None,
        json!({
            "app_pid": std::process::id(),
            "thread": audio_debug_thread_label(),
            "fields": fields,
        }),
    );
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
        "That input source is not available. Choose another microphone and refresh sources."
            .to_string()
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

    let target_index = device_id.parse::<usize>().map_err(|_| {
        "That input source is not available. Choose another microphone and refresh sources."
            .to_string()
    })?;
    let mut input_devices = host
        .input_devices()
        .map_err(|error| native_audio_error_message(error))?;
    let device = input_devices.nth(target_index).ok_or_else(|| {
        "That input source is not available. Choose another microphone and refresh sources."
            .to_string()
    })?;
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

fn recent_native_audio_samples(
    chunks: &VecDeque<NativeAudioChunk>,
    max_samples: usize,
) -> Vec<f32> {
    if max_samples == 0 {
        return Vec::new();
    }

    let mut samples = Vec::with_capacity(max_samples);

    for chunk in chunks.iter().rev() {
        for sample in chunk.samples.iter().rev() {
            samples.push(*sample);
            if samples.len() >= max_samples {
                samples.reverse();
                return samples;
            }
        }
    }

    samples.reverse();
    samples
}

fn native_audio_speech_weight(frequency_hz: f32) -> f32 {
    if frequency_hz < 120.0 {
        0.42
    } else if frequency_hz < 250.0 {
        0.66
    } else if frequency_hz < 600.0 {
        0.88
    } else if frequency_hz < 2800.0 {
        1.0
    } else if frequency_hz < 4200.0 {
        0.76
    } else {
        0.48
    }
}

fn native_audio_frequency_bands(samples: &[f32], sample_rate: u32) -> Vec<f32> {
    if samples.len() < 16 || sample_rate == 0 || AUDIO_INPUT_FREQUENCY_BAND_COUNT == 0 {
        return vec![0.0; AUDIO_INPUT_FREQUENCY_BAND_COUNT];
    }

    let sample_count = samples.len();
    let sample_rate = sample_rate as f32;
    let min_hz = AUDIO_INPUT_FREQUENCY_MIN_HZ.max(1.0);
    let max_hz = AUDIO_INPUT_FREQUENCY_MAX_HZ
        .min(sample_rate * 0.45)
        .max(min_hz);
    let log_min = min_hz.ln();
    let log_max = max_hz.ln();
    let (rms, peak) = native_audio_stats(samples);
    let level_gate = ((rms * 18.0) + (peak * 0.34)).clamp(0.0, 1.0);
    let mut bands = Vec::with_capacity(AUDIO_INPUT_FREQUENCY_BAND_COUNT);

    for band_index in 0..AUDIO_INPUT_FREQUENCY_BAND_COUNT {
        let band_t = if AUDIO_INPUT_FREQUENCY_BAND_COUNT <= 1 {
            0.0
        } else {
            band_index as f32 / (AUDIO_INPUT_FREQUENCY_BAND_COUNT - 1) as f32
        };
        let frequency_hz = (log_min + (log_max - log_min) * band_t).exp();
        let phase_step = (std::f32::consts::TAU * frequency_hz) / sample_rate;
        let mut real = 0.0f32;
        let mut imaginary = 0.0f32;

        for (sample_index, sample) in samples.iter().enumerate() {
            let window = if sample_count <= 1 {
                1.0
            } else {
                0.5 - 0.5
                    * ((std::f32::consts::TAU * sample_index as f32) / (sample_count - 1) as f32)
                        .cos()
            };
            let phase = phase_step * sample_index as f32;
            let weighted = sample * window;
            real += weighted * phase.cos();
            imaginary -= weighted * phase.sin();
        }

        let magnitude =
            ((real * real + imaginary * imaginary).sqrt() / sample_count as f32).max(0.0);
        let magnitude_db = 20.0 * (magnitude + 1.0e-9).log10();
        let normalized = ((magnitude_db - AUDIO_INPUT_FREQUENCY_MIN_DB)
            / (AUDIO_INPUT_FREQUENCY_MAX_DB - AUDIO_INPUT_FREQUENCY_MIN_DB))
            .clamp(0.0, 1.0);
        let speech_weight = native_audio_speech_weight(frequency_hz);
        bands.push((normalized * speech_weight * (0.38 + (level_gate * 0.62))).clamp(0.0, 1.0));
    }

    bands
}

fn native_audio_envelope_samples(
    samples: &[f32],
    sample_count: usize,
    sample_rate: u32,
) -> Vec<f32> {
    if sample_count == 0 {
        return Vec::new();
    }

    if samples.is_empty() {
        return vec![0.0; sample_count];
    }

    let mean = samples.iter().sum::<f32>() / samples.len() as f32;

    if sample_count == 1 || samples.len() == 1 {
        return vec![(samples[0] - mean).abs().clamp(0.0, 1.0)];
    }

    let source_span = (samples.len() - 1) as f32;
    let target_span = (sample_count - 1) as f32;
    let sample_step = (samples.len() as f32 / sample_count as f32).max(1.0);
    let half_window = (sample_step * 1.7).round() as isize;
    let max_window = ((sample_rate as f32 * 0.0025).round() as isize).max(4);
    let half_window = half_window.clamp(4, max_window);
    let mut envelope = Vec::with_capacity(sample_count);

    for index in 0..sample_count {
        let position = (index as f32 / target_span) * source_span;
        let center = position.round() as isize;
        let start = (center - half_window).max(0) as usize;
        let end = (center + half_window).min(samples.len() as isize - 1) as usize;
        let mut sum_squares = 0.0f32;
        let mut peak = 0.0f32;
        let mut count = 0usize;

        for sample in &samples[start..=end] {
            let value = (*sample - mean).clamp(-1.0, 1.0);
            sum_squares += value * value;
            peak = peak.max(value.abs());
            count += 1;
        }

        let rms = (sum_squares / count.max(1) as f32).sqrt();

        envelope.push(((rms * 0.78) + (peak * 0.22)).clamp(0.0, 1.0));
    }

    envelope
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
    let max_seconds = if shared.capture_started_at.is_some() {
        AUDIO_CAPTURE_MAX_SECONDS + (AUDIO_CAPTURE_PREROLL_MS as f64 / 1000.0)
    } else {
        AUDIO_BUFFER_MAX_SECONDS
    };
    let max_samples = (shared.sample_rate as f64 * max_seconds).round() as usize;

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
        shared.total_samples += shared
            .chunks
            .back()
            .map(|chunk| chunk.samples.len())
            .unwrap_or(0);
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
            let frequency_samples =
                recent_native_audio_samples(&shared.chunks, AUDIO_INPUT_FREQUENCY_WINDOW_SAMPLES);
            let frequency_bands =
                native_audio_frequency_bands(&frequency_samples, shared.sample_rate);
            let waveform_samples =
                recent_native_audio_samples(&shared.chunks, AUDIO_INPUT_WAVEFORM_WINDOW_SAMPLES);
            let time_domain_samples = native_audio_envelope_samples(
                &waveform_samples,
                AUDIO_INPUT_WAVEFORM_SAMPLE_COUNT,
                shared.sample_rate,
            );
            Some(AudioInputStats {
                device_id: device_id.to_string(),
                rms,
                peak,
                buffer_ms: ((shared.total_samples as f64 / shared.sample_rate as f64) * 1000.0)
                    .round() as u64,
                frequency_bands,
                time_domain_samples,
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

    let max_samples = (shared.sample_rate as f64 * AUDIO_CAPTURE_MAX_SECONDS).round() as usize;
    let bounded_samples = if captured_samples.len() > max_samples {
        captured_samples[captured_samples.len() - max_samples..].to_vec()
    } else {
        captured_samples
    };
    let audio_ms =
        ((bounded_samples.len() as f64 / shared.sample_rate as f64) * 1000.0).round() as u64;
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
    let (status, buffered_audio, buffered_chunks, buffered_input_ms) = {
        let mut shared = active_session
            .shared
            .lock()
            .map_err(|_| "Unable to lock native audio input buffer.".to_string())?;
        let mut buffered_audio = Vec::new();
        let mut buffered_chunks = 0u64;
        let mut buffered_input_ms = 0.0f64;

        if let Some(capture_started_at) = shared.capture_started_at {
            for chunk in shared
                .chunks
                .iter()
                .filter(|chunk| native_audio_chunk_reaches(chunk, capture_started_at))
            {
                buffered_chunks += 1;
                buffered_input_ms += chunk.duration_ms;
                buffered_audio.push(encode_linear16_audio(&chunk.samples));
            }
        }

        shared.realtime_audio_tx = Some(audio_tx.clone());

        (
            native_audio_status(active_session),
            buffered_audio,
            buffered_chunks,
            buffered_input_ms,
        )
    };

    for audio_bytes in buffered_audio {
        let _ = audio_tx.send(audio_bytes);
    }

    log_whisper_local_audio_event(
        "audio.realtime.attach",
        None,
        json!({
            "device_id": &status.device_id,
            "label": &status.label,
            "sample_rate": status.sample_rate,
            "owner_count": status.owner_count,
            "buffered_chunks": buffered_chunks,
            "buffered_input_ms": buffered_input_ms,
        }),
    );

    Ok(status)
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
    let session = session.ok_or_else(|| {
        "Choose and enable a microphone in the Audio tab before recording.".to_string()
    })?;
    let mut shared = session
        .shared
        .lock()
        .map_err(|_| "Unable to lock native audio input buffer.".to_string())?;
    let now = Instant::now();
    let capture_started_at = now
        .checked_sub(Duration::from_millis(AUDIO_CAPTURE_PREROLL_MS))
        .unwrap_or(now);
    let buffered_ms =
        ((shared.total_samples as f64 / shared.sample_rate as f64) * 1000.0).round() as u64;
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
    let session = session.ok_or_else(|| {
        "Choose and enable a microphone in the Audio tab before recording.".to_string()
    })?;
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
            PathBuf::from("/opt/homebrew/bin/whisper"),
            PathBuf::from("/usr/local/bin/whisper"),
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

fn whisper_runtime_installable() -> bool {
    WHISPER_RUNTIME_URL.is_some() || cfg!(target_os = "macos")
}

#[cfg(target_os = "macos")]
fn homebrew_executable_path() -> Option<PathBuf> {
    if let Some(brew) = find_executable_on_path(&["brew"]) {
        return Some(brew);
    }

    [
        PathBuf::from("/opt/homebrew/bin/brew"),
        PathBuf::from("/usr/local/bin/brew"),
    ]
    .into_iter()
    .find(|candidate| candidate.is_file())
}

#[cfg(target_os = "macos")]
fn install_whisper_runtime_with_homebrew(app: &AppHandle) -> Result<bool, String> {
    let Some(brew_path) = homebrew_executable_path() else {
        emit_audio_download_progress(
            app,
            WhisperModelDownloadProgress {
                state: "runtime-missing".to_string(),
                downloaded_bytes: 0,
                total_bytes: None,
                percent: Some(100.0),
                message: WHISPER_HOMEBREW_MISSING_HINT.to_string(),
            },
        );

        return Ok(false);
    };

    emit_audio_download_progress(
        app,
        WhisperModelDownloadProgress {
            state: "runtime".to_string(),
            downloaded_bytes: 0,
            total_bytes: None,
            percent: None,
            message: "Installing whisper.cpp with Homebrew.".to_string(),
        },
    );

    let brew_binary = brew_path.to_string_lossy().to_string();
    let capture = run_command_capture(
        &brew_binary,
        &["install", "whisper-cpp"],
        None,
        Duration::from_secs(WHISPER_DOWNLOAD_TIMEOUT_SECS),
        None,
    )
    .map_err(|error| format!("Unable to run Homebrew: {error}"))?;

    if capture.exit_code != Some(0) {
        let detail = first_output_line(&command_output_text(&capture.stdout, &capture.stderr));

        emit_audio_download_progress(
            app,
            WhisperModelDownloadProgress {
                state: "runtime-missing".to_string(),
                downloaded_bytes: 0,
                total_bytes: None,
                percent: Some(100.0),
                message: "Homebrew could not install whisper.cpp.".to_string(),
            },
        );

        if detail.is_empty() {
            return Err("Homebrew could not install whisper.cpp.".to_string());
        }

        return Err(format!("Homebrew could not install whisper.cpp: {detail}"));
    }

    emit_audio_download_progress(
        app,
        WhisperModelDownloadProgress {
            state: "runtime".to_string(),
            downloaded_bytes: 0,
            total_bytes: None,
            percent: Some(100.0),
            message: "Homebrew finished installing whisper.cpp.".to_string(),
        },
    );

    Ok(true)
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
    let managed_assets_installed = model_installed
        || managed_runtime_installed
        || runtime_directory.exists()
        || runtime_zip_path.exists();

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
            .unwrap_or_else(|| runtime_directory.display().to_string()),
        runtime_installable: whisper_runtime_installable(),
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
        || lowercase.starts_with("load_backend:")
        || lowercase.starts_with("whisper_init")
        || lowercase.starts_with("ggml_")
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WhisperTranscriptPolicy {
    name: String,
    audio_ms_min_for_speech_ms: Option<u64>,
    capture_rms_min_for_speech: Option<f32>,
    capture_peak_min_for_speech: Option<f32>,
    suppress_bracketted_markers: bool,
    suppress_bracketted_markers_max_chars: usize,
    no_speech_markers: Vec<String>,
    low_energy_suppressed_tokens: Vec<String>,
    low_energy_max_chars: usize,
    low_energy_max_words: usize,
}

impl WhisperTranscriptPolicy {
    fn merged_with_default(mut self) -> Self {
        let default = WhisperTranscriptPolicy::default();

        if self.name.trim().is_empty() {
            self.name = default.name;
        }

        if self.audio_ms_min_for_speech_ms.is_none() {
            self.audio_ms_min_for_speech_ms = default.audio_ms_min_for_speech_ms;
        }

        if self.capture_rms_min_for_speech.is_none() {
            self.capture_rms_min_for_speech = default.capture_rms_min_for_speech;
        }

        if self.capture_peak_min_for_speech.is_none() {
            self.capture_peak_min_for_speech = default.capture_peak_min_for_speech;
        }

        if self.suppress_bracketted_markers_max_chars == 0 {
            self.suppress_bracketted_markers_max_chars =
                default.suppress_bracketted_markers_max_chars;
        }

        if self.low_energy_max_chars == 0 {
            self.low_energy_max_chars = default.low_energy_max_chars;
        }

        if self.low_energy_max_words == 0 {
            self.low_energy_max_words = default.low_energy_max_words;
        }

        if self.no_speech_markers.is_empty() {
            self.no_speech_markers = default.no_speech_markers;
        }

        if self.low_energy_suppressed_tokens.is_empty() {
            self.low_energy_suppressed_tokens = default.low_energy_suppressed_tokens;
        }

        self
    }
}

impl Default for WhisperTranscriptPolicy {
    fn default() -> Self {
        Self {
            name: "whisper-local-coding-policy".to_string(),
            audio_ms_min_for_speech_ms: Some(900),
            capture_rms_min_for_speech: Some(0.01),
            capture_peak_min_for_speech: Some(0.02),
            suppress_bracketted_markers: true,
            suppress_bracketted_markers_max_chars: 24,
            no_speech_markers: vec![
                "[BLANK_AUDIO]".to_string(),
                "[BLANK]".to_string(),
                "[SILENCE]".to_string(),
                "[NOISE]".to_string(),
                "[MUSIC]".to_string(),
            ],
            low_energy_suppressed_tokens: vec!["you".to_string()],
            low_energy_max_chars: 4,
            low_energy_max_words: 1,
        }
    }
}

fn whisper_transcript_policy_path() -> &'static str {
    include_str!("../whisper-transcript-policy.json")
}

fn whisper_transcript_policy() -> &'static WhisperTranscriptPolicy {
    static POLICY: OnceLock<WhisperTranscriptPolicy> = OnceLock::new();

    POLICY.get_or_init(|| {
        let default = WhisperTranscriptPolicy::default();
        let policy: WhisperTranscriptPolicy =
            serde_json::from_str(whisper_transcript_policy_path()).unwrap_or_else(|error| {
                log_whisper_local_audio_event(
                    "whisper.policy.load_failed",
                    None,
                    json!({
                        "policy_name": &default.name,
                        "policy_path": "whisper-transcript-policy.json",
                        "error": clean_whisper_local_audio_log_text(&error.to_string()),
                    }),
                );

                default
            });

        policy.merged_with_default()
    })
}

fn is_low_energy_capture(
    policy: &WhisperTranscriptPolicy,
    request: &WhisperTranscriptionRequest,
) -> bool {
    let rms = request
        .capture_rms
        .map(|value| value.max(0.0f32))
        .unwrap_or(f32::MAX);
    let peak = request
        .capture_peak
        .map(|value| value.max(0.0f32))
        .unwrap_or(f32::MAX);
    let audio_ms = request.audio_ms.unwrap_or(u64::MAX);

    policy
        .capture_rms_min_for_speech
        .is_some_and(|threshold| rms < threshold)
        || policy
            .capture_peak_min_for_speech
            .is_some_and(|threshold| peak < threshold)
        || policy
            .audio_ms_min_for_speech_ms
            .is_some_and(|threshold| audio_ms < threshold)
}

fn whisper_local_transcript_drop_reason(
    policy: &WhisperTranscriptPolicy,
    request: &WhisperTranscriptionRequest,
    text: &str,
) -> Option<String> {
    let normalized = text.trim();

    if normalized.is_empty() {
        return Some("empty_transcript".to_string());
    }

    let normalized_lower = normalized.to_lowercase();
    if policy
        .no_speech_markers
        .iter()
        .any(|marker| normalized_lower == marker.to_lowercase())
    {
        return Some("no_speech_marker".to_string());
    }

    if policy.suppress_bracketted_markers
        && normalized.len() <= policy.suppress_bracketted_markers_max_chars
        && normalized.starts_with('[')
        && normalized.ends_with(']')
    {
        return Some("bracketed_marker".to_string());
    }

    if is_low_energy_capture(policy, request) {
        let word_count = normalized.split_whitespace().count();
        if word_count <= policy.low_energy_max_words
            && normalized.chars().count() <= policy.low_energy_max_chars
            && policy
                .low_energy_suppressed_tokens
                .iter()
                .any(|token| normalized.eq_ignore_ascii_case(token))
        {
            return Some("low_energy_short_token".to_string());
        }
    }

    None
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
    body.get("err_msg")
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
    let transcript = if capture.exit_code == Some(0) {
        capture.stdout.trim().to_string()
    } else {
        command_output_text(&capture.stdout, &capture.stderr)
    };
    let policy = whisper_transcript_policy();
    let mut text = normalize_transcript_text(&transcript);
    if let Some(reason) = whisper_local_transcript_drop_reason(policy, &request, &text) {
        log_whisper_local_audio_event(
            "whisper.transcribe.policy_drop",
            Some(started_at.elapsed()),
            json!({
                "policy_name": &policy.name,
                "reason": reason,
                "audio_ms": request.audio_ms,
                "capture_rms": request.capture_rms,
                "capture_peak": request.capture_peak,
            }),
        );
        text.clear();
    }
    let _ = fs::remove_file(&audio_path);
    log_whisper_local_audio_event(
        "whisper.transcribe.output_read.done",
        Some(read_started_at.elapsed()),
        json!({
            "raw_transcript_chars": transcript.chars().count(),
            "clean_text_chars": text.chars().count(),
            "used_transcript_file": false,
            "audio_path_removed": true,
            "policy_name": &policy.name,
            "policy_drop": text.is_empty(),
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
    log_audio_diagnostic_event(
        "audio.widget.ensure.start",
        json!({
            "label": AUDIO_WIDGET_WINDOW_LABEL,
        }),
    );

    if let Some(window) = app.get_webview_window(AUDIO_WIDGET_WINDOW_LABEL) {
        let visible = window.is_visible().ok();
        log_audio_diagnostic_event(
            "audio.widget.ensure.existing",
            json!({
                "label": AUDIO_WIDGET_WINDOW_LABEL,
                "visible": visible,
            }),
        );
        return Ok(window);
    }

    log_audio_diagnostic_event(
        "audio.widget.ensure.create_start",
        json!({
            "label": AUDIO_WIDGET_WINDOW_LABEL,
        }),
    );

    let window = match WebviewWindowBuilder::new(
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
    .accept_first_mouse(true)
    .transparent(true)
    .background_color(Color(0, 0, 0, 0))
    .visible(false)
    .shadow(false)
    .build()
    {
        Ok(window) => {
            log_audio_diagnostic_event(
                "audio.widget.ensure.create_done",
                json!({
                    "label": AUDIO_WIDGET_WINDOW_LABEL,
                }),
            );
            window
        }
        Err(error) => {
            let message = format!("Unable to create audio widget: {error}");
            log_audio_diagnostic_event(
                "audio.widget.ensure.create_error",
                json!({
                    "label": AUDIO_WIDGET_WINDOW_LABEL,
                    "error": clean_whisper_local_audio_log_text(&message),
                }),
            );
            return Err(message);
        }
    };

    match window.set_background_color(Some(Color(0, 0, 0, 0))) {
        Ok(()) => log_audio_diagnostic_event(
            "audio.widget.ensure.background_done",
            json!({
                "label": AUDIO_WIDGET_WINDOW_LABEL,
            }),
        ),
        Err(error) => log_audio_diagnostic_event(
            "audio.widget.ensure.background_error",
            json!({
                "label": AUDIO_WIDGET_WINDOW_LABEL,
                "error": clean_whisper_local_audio_log_text(&error.to_string()),
            }),
        ),
    }

    let app_handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            log_audio_diagnostic_event(
                "audio.widget.window.destroyed",
                json!({
                    "label": AUDIO_WIDGET_WINDOW_LABEL,
                }),
            );
            emit_audio_widget_current_visibility(&app_handle, false);
        }
    });

    Ok(window)
}

fn run_audio_widget_action_on_main_thread<T, F>(
    app: &AppHandle,
    action_name: &'static str,
    action: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&AppHandle) -> Result<T, String> + Send + 'static,
{
    let started_at = Instant::now();
    let app_for_task = app.clone();
    let (response_tx, response_rx) = std::sync::mpsc::channel();

    log_audio_diagnostic_event(
        "audio.widget.main_thread.schedule",
        json!({
            "action": action_name,
        }),
    );

    app.run_on_main_thread(move || {
        log_audio_diagnostic_event(
            "audio.widget.main_thread.action_start",
            json!({
                "action": action_name,
            }),
        );
        let result = action(&app_for_task);
        match &result {
            Ok(_) => log_audio_diagnostic_event(
                "audio.widget.main_thread.action_done",
                json!({
                    "action": action_name,
                }),
            ),
            Err(error) => log_audio_diagnostic_event(
                "audio.widget.main_thread.action_error",
                json!({
                    "action": action_name,
                    "error": clean_whisper_local_audio_log_text(error),
                }),
            ),
        }
        let _ = response_tx.send(result);
    })
    .map_err(|error| {
        let message = format!("Unable to schedule audio widget action: {error}");
        log_audio_diagnostic_event(
            "audio.widget.main_thread.schedule_error",
            json!({
                "action": action_name,
                "error": clean_whisper_local_audio_log_text(&message),
            }),
        );
        message
    })?;

    log_audio_diagnostic_event(
        "audio.widget.main_thread.wait_start",
        json!({
            "action": action_name,
        }),
    );

    let result = response_rx.recv().map_err(|_| {
        let message = "Audio widget action did not complete.".to_string();
        log_audio_diagnostic_event(
            "audio.widget.main_thread.wait_error",
            json!({
                "action": action_name,
                "elapsed_ms": started_at.elapsed().as_secs_f64() * 1000.0,
                "error": clean_whisper_local_audio_log_text(&message),
            }),
        );
        message
    })?;

    log_audio_diagnostic_event(
        "audio.widget.main_thread.wait_done",
        json!({
            "action": action_name,
            "elapsed_ms": started_at.elapsed().as_secs_f64() * 1000.0,
            "ok": result.is_ok(),
        }),
    );

    result
}

fn show_audio_widget_window_on_main_thread(app: &AppHandle, focus: bool) -> Result<(), String> {
    log_audio_diagnostic_event(
        "audio.widget.show_window.request",
        json!({
            "focus": focus,
        }),
    );

    run_audio_widget_action_on_main_thread(app, "show", move |app| {
        let window = ensure_audio_widget_window(app)?;
        window
            .show()
            .map_err(|error| format!("Unable to show audio widget: {error}"))?;

        if focus {
            let _ = window.set_focus();
        }

        Ok(())
    })
}

fn hide_audio_widget_window_on_main_thread(app: &AppHandle) -> Result<(), String> {
    log_audio_diagnostic_event("audio.widget.hide_window.request", json!({}));

    run_audio_widget_action_on_main_thread(app, "hide", |app| {
        if let Some(window) = app.get_webview_window(AUDIO_WIDGET_WINDOW_LABEL) {
            window
                .hide()
                .map_err(|error| format!("Unable to hide audio widget: {error}"))?;
        }

        Ok(())
    })
}

fn audio_widget_visible_on_main_thread(app: &AppHandle) -> Result<bool, String> {
    log_audio_diagnostic_event("audio.widget.visible.request", json!({}));

    run_audio_widget_action_on_main_thread(app, "visible", |app| {
        let visible = app
            .get_webview_window(AUDIO_WIDGET_WINDOW_LABEL)
            .and_then(|window| window.is_visible().ok())
            .unwrap_or(false);
        log_audio_diagnostic_event(
            "audio.widget.visible.result",
            json!({
                "visible": visible,
            }),
        );
        Ok(visible)
    })
}

fn audio_widget_visibility_for(
    app: &AppHandle,
    visible: bool,
) -> Result<AudioWidgetVisibility, String> {
    log_audio_diagnostic_event(
        "audio.widget.visibility.status_start",
        json!({
            "visible": visible,
        }),
    );
    let status = whisper_model_status_for(app)?;

    let visibility = AudioWidgetVisibility {
        visible,
        installed: status.installed,
        shortcut: status.shortcut,
    };
    log_audio_diagnostic_event(
        "audio.widget.visibility.status_done",
        json!({
            "visible": visibility.visible,
            "installed": visibility.installed,
            "shortcut": visibility.shortcut,
        }),
    );
    Ok(visibility)
}

fn audio_widget_status_for(app: &AppHandle) -> Result<AudioWidgetVisibility, String> {
    log_audio_diagnostic_event("audio.widget.status.start", json!({}));
    let visible = audio_widget_visible_on_main_thread(app)?;

    let visibility = audio_widget_visibility_for(app, visible)?;
    log_audio_diagnostic_event(
        "audio.widget.status.done",
        json!({
            "visible": visibility.visible,
            "installed": visibility.installed,
            "shortcut": visibility.shortcut,
        }),
    );
    Ok(visibility)
}

fn emit_audio_widget_visibility_changed(app: &AppHandle, visibility: &AudioWidgetVisibility) {
    match app.emit(AUDIO_WIDGET_VISIBILITY_CHANGED_EVENT, visibility.clone()) {
        Ok(()) => log_audio_diagnostic_event(
            "audio.widget.visibility.emit_done",
            json!({
                "visible": visibility.visible,
                "installed": visibility.installed,
                "shortcut": visibility.shortcut,
            }),
        ),
        Err(error) => log_audio_diagnostic_event(
            "audio.widget.visibility.emit_error",
            json!({
                "visible": visibility.visible,
                "installed": visibility.installed,
                "shortcut": visibility.shortcut,
                "error": clean_whisper_local_audio_log_text(&error.to_string()),
            }),
        ),
    }
}

fn emit_audio_widget_current_visibility(app: &AppHandle, visible: bool) {
    match audio_widget_visibility_for(app, visible) {
        Ok(visibility) => emit_audio_widget_visibility_changed(app, &visibility),
        Err(error) => log_audio_diagnostic_event(
            "audio.widget.visibility.current_error",
            json!({
                "visible": visible,
                "error": clean_whisper_local_audio_log_text(&error),
            }),
        ),
    }
}

fn show_audio_widget_for(app: &AppHandle) -> Result<AudioWidgetVisibility, String> {
    log_audio_diagnostic_event("audio.widget.show.start", json!({}));
    let status = match whisper_model_status_for(app) {
        Ok(status) => status,
        Err(error) => {
            log_audio_diagnostic_event(
                "audio.widget.show.status_error",
                json!({
                    "error": clean_whisper_local_audio_log_text(&error),
                }),
            );
            return Err(error);
        }
    };

    if let Err(error) = show_audio_widget_window_on_main_thread(app, true) {
        log_audio_diagnostic_event(
            "audio.widget.show.window_error",
            json!({
                "error": clean_whisper_local_audio_log_text(&error),
            }),
        );
        return Err(error);
    }

    let visibility = AudioWidgetVisibility {
        visible: true,
        installed: status.installed,
        shortcut: audio_push_to_talk_shortcut_for(app),
    };
    emit_audio_widget_visibility_changed(app, &visibility);
    log_audio_diagnostic_event(
        "audio.widget.show.done",
        json!({
            "visible": visibility.visible,
            "installed": visibility.installed,
            "shortcut": visibility.shortcut,
        }),
    );
    Ok(visibility)
}

fn hide_audio_widget_for(app: &AppHandle) -> Result<AudioWidgetVisibility, String> {
    log_audio_diagnostic_event("audio.widget.hide.start", json!({}));
    if let Err(error) = hide_audio_widget_window_on_main_thread(app) {
        log_audio_diagnostic_event(
            "audio.widget.hide.window_error",
            json!({
                "error": clean_whisper_local_audio_log_text(&error),
            }),
        );
        return Err(error);
    }

    let visibility = audio_widget_visibility_for(app, false)?;
    emit_audio_widget_visibility_changed(app, &visibility);
    log_audio_diagnostic_event(
        "audio.widget.hide.done",
        json!({
            "visible": visibility.visible,
            "installed": visibility.installed,
            "shortcut": visibility.shortcut,
        }),
    );
    Ok(visibility)
}

fn toggle_audio_widget_for(app: &AppHandle) -> Result<AudioWidgetVisibility, String> {
    log_audio_diagnostic_event("audio.widget.toggle.start", json!({}));
    let visible = audio_widget_visible_on_main_thread(app)?;
    log_audio_diagnostic_event(
        "audio.widget.toggle.visible",
        json!({
            "visible": visible,
        }),
    );
    if visible {
        return hide_audio_widget_for(app);
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

    #[cfg(target_os = "macos")]
    if whisper_runtime_executable_path(&app)?.is_none() && homebrew_executable_path().is_none() {
        emit_audio_download_progress(
            &app,
            WhisperModelDownloadProgress {
                state: "runtime-missing".to_string(),
                downloaded_bytes: 0,
                total_bytes: None,
                percent: Some(100.0),
                message: WHISPER_HOMEBREW_MISSING_HINT.to_string(),
            },
        );

        return whisper_model_status_for(&app);
    }

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

    #[cfg(target_os = "macos")]
    if whisper_runtime_executable_path(&app)?.is_none()
        && !install_whisper_runtime_with_homebrew(&app)?
    {
        return whisper_model_status_for(&app);
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

fn clean_cloud_voice_agent_text(value: Option<String>, max_chars: usize) -> String {
    value
        .unwrap_or_default()
        .trim()
        .chars()
        .filter(|ch| !ch.is_control())
        .take(max_chars)
        .collect()
}

fn clean_cloud_voice_agent_message_text(value: String, max_chars: usize) -> String {
    value
        .trim()
        .chars()
        .filter(|ch| !ch.is_control() || matches!(ch, '\n' | '\r' | '\t'))
        .take(max_chars)
        .collect()
}

fn cloud_voice_agent_header(value: &str, label: &str) -> Result<HeaderValue, String> {
    HeaderValue::from_str(value).map_err(|error| format!("Invalid {label} header: {error}"))
}

fn cloud_voice_agent_ws_request(
    ws_target: &CloudMcpWsTarget,
    auth_bearer: Option<&str>,
    workspace_id: &str,
    repo_id: &str,
) -> Result<tokio_tungstenite::tungstenite::http::Request<()>, String> {
    let mut request = ws_target
        .ws_url
        .as_str()
        .into_client_request()
        .map_err(|error| format!("Unable to prepare cloud voice agent websocket: {error}"))?;
    request.headers_mut().insert(
        "x-diffforge-actor",
        HeaderValue::from_static("orchestrator-voice"),
    );
    request.headers_mut().insert(
        "user-agent",
        HeaderValue::from_static(CLOUD_MCP_DESKTOP_USER_AGENT),
    );
    if !workspace_id.is_empty() {
        request.headers_mut().insert(
            "x-diffforge-workspace-id",
            cloud_voice_agent_header(workspace_id, "workspace id")?,
        );
    }
    if !repo_id.is_empty() {
        request.headers_mut().insert(
            "x-diffforge-repo-id",
            cloud_voice_agent_header(repo_id, "repo id")?,
        );
    }
    if let Some(token) = auth_bearer {
        request.headers_mut().insert(
            "authorization",
            cloud_mcp_bearer_header(token, "Cloud voice agent auth token")?,
        );
    }
    if let Some(route_token) = ws_target.route_token.as_deref() {
        request.headers_mut().insert(
            "x-diffforge-direct-route-token",
            HeaderValue::from_str(route_token)
                .map_err(|error| format!("Invalid Cloud voice agent route token header: {error}"))?,
        );
    }
    Ok(request)
}

fn emit_cloud_voice_agent_event(app: &AppHandle, payload: Value) {
    let _ = app.emit(CLOUD_VOICE_AGENT_EVENT, payload);
}

fn cloud_voice_agent_llm_orchestrator_policy() -> Value {
    json!({
        "mode": "respond_or_create_plan",
        "disable_search": true,
        "disabled_tools": [
            "search",
            "web_search",
            "web_search_preview",
            "browser_search",
            "file_search"
        ],
        "allowed_tools": ["create_plan", "open_coding_agents"],
        "tool_choice": "auto",
        "response_contract": {
            "immediate_feedback_required": true,
            "main_response_required": true,
            "main_response_may_call_tool": true,
            "regular_response_kind": "voice_agent_llm_feedback",
            "plan_tool_name": "create_plan",
            "agent_open_tool_name": "open_coding_agents",
            "plan_snapshot_kind": "voice_agent_plan_snapshot"
        }
    })
}

fn voice_history_safe_workspace_id(value: &str) -> String {
    let mut safe = value
        .trim()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '_'
            }
        })
        .take(120)
        .collect::<String>();
    if safe.is_empty() {
        safe = "default".to_string();
    }
    safe
}

fn voice_history_path(root_directory: Option<&str>, workspace_id: &str) -> Result<PathBuf, String> {
    let root = resolve_workspace_root_directory(root_directory)?;
    let agents_dir = root.join(".agents");
    fs::create_dir_all(&agents_dir)
        .map_err(|error| format!("Unable to create workspace .agents directory: {error}"))?;
    let _ = ensure_workspace_agents_gitignore(&root);
    let history_dir = agents_dir.join("voice-history");
    fs::create_dir_all(&history_dir)
        .map_err(|error| format!("Unable to create voice history directory: {error}"))?;
    Ok(history_dir.join(format!(
        "{}.json",
        voice_history_safe_workspace_id(workspace_id)
    )))
}

fn read_orchestrator_voice_history_blocking(
    request: OrchestratorVoiceHistoryReadRequest,
) -> Result<OrchestratorVoiceHistoryReadResult, String> {
    let workspace_id = clean_cloud_voice_agent_text(Some(request.workspace_id), 160);
    let workspace_id = if workspace_id.is_empty() {
        "default".to_string()
    } else {
        workspace_id
    };
    let path = voice_history_path(request.root_directory.as_deref(), &workspace_id)?;
    let items = match fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str::<Value>(&contents).unwrap_or_else(|_| json!([])),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => json!([]),
        Err(error) => return Err(format!("Unable to read voice history: {error}")),
    };
    Ok(OrchestratorVoiceHistoryReadResult {
        items,
        path: path.display().to_string(),
        workspace_id,
    })
}

fn write_orchestrator_voice_history_blocking(
    request: OrchestratorVoiceHistoryWriteRequest,
) -> Result<OrchestratorVoiceHistoryWriteResult, String> {
    let workspace_id = clean_cloud_voice_agent_text(Some(request.workspace_id), 160);
    let workspace_id = if workspace_id.is_empty() {
        "default".to_string()
    } else {
        workspace_id
    };
    let path = voice_history_path(request.root_directory.as_deref(), &workspace_id)?;
    let items = match request.items {
        Value::Array(items) => Value::Array(items.into_iter().take(24).collect()),
        _ => json!([]),
    };
    let bytes = serde_json::to_vec_pretty(&items)
        .map_err(|error| format!("Unable to serialize voice history: {error}"))?;
    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, bytes)
        .map_err(|error| format!("Unable to write voice history: {error}"))?;
    fs::rename(&temp_path, &path)
        .map_err(|error| format!("Unable to save voice history: {error}"))?;
    Ok(OrchestratorVoiceHistoryWriteResult {
        saved: items.as_array().map(Vec::len).unwrap_or(0),
        path: path.display().to_string(),
        workspace_id,
    })
}

#[tauri::command]
async fn read_orchestrator_voice_history(
    request: OrchestratorVoiceHistoryReadRequest,
) -> Result<OrchestratorVoiceHistoryReadResult, String> {
    tauri::async_runtime::spawn_blocking(move || read_orchestrator_voice_history_blocking(request))
        .await
        .map_err(|error| format!("Unable to load voice history: {error}"))?
}

#[tauri::command]
async fn write_orchestrator_voice_history(
    request: OrchestratorVoiceHistoryWriteRequest,
) -> Result<OrchestratorVoiceHistoryWriteResult, String> {
    tauri::async_runtime::spawn_blocking(move || write_orchestrator_voice_history_blocking(request))
        .await
        .map_err(|error| format!("Unable to persist voice history: {error}"))?
}

fn is_expected_cloud_voice_agent_close_error(error: &str) -> bool {
    let error = error.to_ascii_lowercase();
    error.contains("connection reset without closing handshake")
        || error.contains("connection closed")
        || error.contains("already closed")
        || error.contains("closed by peer")
        || error.contains("reset by peer")
        || error.contains("websocket protocol error: connection reset")
}

fn cloud_voice_agent_event_kind(payload: &Value) -> &str {
    payload
        .get("kind")
        .or_else(|| payload.get("type"))
        .and_then(Value::as_str)
        .unwrap_or_default()
}

fn cloud_voice_agent_payload_from_ws_message(message: &Message) -> Option<Value> {
    match message {
        Message::Text(text) => serde_json::from_str::<Value>(text.as_str()).ok(),
        Message::Binary(bytes) => String::from_utf8(bytes.to_vec())
            .ok()
            .and_then(|text| serde_json::from_str::<Value>(&text).ok()),
        _ => None,
    }
}

fn cloud_voice_agent_error_message(payload: &Value) -> Option<String> {
    if cloud_voice_agent_event_kind(payload) != "voice_agent_error" {
        return None;
    }
    payload
        .pointer("/error/message")
        .or_else(|| payload.get("message"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

async fn cloud_voice_agent_pending_error_message<R>(read: &mut R) -> Option<String>
where
    R: futures_util::Stream<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin,
{
    match timeout(Duration::from_millis(75), read.next()).await {
        Ok(Some(Ok(message))) => {
            if let Some(payload) = cloud_voice_agent_payload_from_ws_message(&message) {
                if let Some(error) = cloud_voice_agent_error_message(&payload) {
                    return Some(format!("Cloud voice agent returned an error: {error}"));
                }
                if cloud_voice_agent_event_kind(&payload) == "voice_agent_finished" {
                    return Some(
                        "Cloud voice agent finished before accepting more audio.".to_string(),
                    );
                }
            }
            match message {
                Message::Close(frame) => {
                    let reason = frame
                        .as_ref()
                        .map(|frame| frame.reason.trim().to_string())
                        .filter(|reason| !reason.is_empty())
                        .unwrap_or_else(|| "connection closed".to_string());
                    Some(format!("Cloud voice agent closed the websocket: {reason}"))
                }
                _ => None,
            }
        }
        Ok(Some(Err(error))) => Some(format!("Cloud voice agent stream failed: {error}")),
        Ok(None) => Some("Cloud voice agent closed before accepting more audio.".to_string()),
        Err(_) => None,
    }
}

fn cloud_voice_agent_event_completes_request(payload: &Value) -> bool {
    matches!(
        cloud_voice_agent_event_kind(payload),
        "voice_agent_finished" | "voice_agent_error"
    )
}

fn cloud_voice_agent_tts_suppression_active(deadline: Option<Instant>) -> bool {
    match deadline {
        Some(deadline) => deadline > Instant::now(),
        None => false,
    }
}

fn update_cloud_voice_agent_tts_suppression(
    payload: &Value,
    suppression_until: &mut Option<Instant>,
) {
    let now = Instant::now();
    match cloud_voice_agent_event_kind(payload) {
        "voice_agent_tts_start" => {
            *suppression_until =
                Some(now + Duration::from_millis(CLOUD_VOICE_AGENT_TTS_SUPPRESSION_MAX_MS));
        }
        "voice_agent_tts_audio" => {
            let next_deadline =
                now + Duration::from_millis(CLOUD_VOICE_AGENT_TTS_SUPPRESSION_TAIL_MS);
            if suppression_until
                .map(|deadline| deadline < next_deadline)
                .unwrap_or(true)
            {
                *suppression_until = Some(next_deadline);
            }
        }
        "voice_agent_tts_end" | "voice_agent_tts_error" => {
            *suppression_until =
                Some(now + Duration::from_millis(CLOUD_VOICE_AGENT_TTS_SUPPRESSION_TAIL_MS));
        }
        _ => {}
    }
}

async fn run_cloud_voice_agent_stream(
    app: AppHandle,
    ws_target: CloudMcpWsTarget,
    auth_bearer: Option<String>,
    start_request: Value,
    workspace_id: String,
    repo_id: String,
    sample_rate: u32,
    mut audio_rx: mpsc::UnboundedReceiver<Vec<u8>>,
    mut control_rx: mpsc::UnboundedReceiver<CloudVoiceAgentControl>,
    ready_tx: oneshot::Sender<Result<(), String>>,
    finished_tx: oneshot::Sender<Result<(), String>>,
) {
    let mut ready_tx = Some(ready_tx);
    let mut opened_target = ws_target.clone();
    let request = match cloud_voice_agent_ws_request(
        &opened_target,
        auth_bearer.as_deref(),
        &workspace_id,
        &repo_id,
    ) {
        Ok(request) => request,
        Err(error) => {
            if let Some(ready_tx) = ready_tx.take() {
                let _ = ready_tx.send(Err(error.clone()));
            }
            let _ = finished_tx.send(Err(error));
            return;
        }
    };

    let (ws_stream, _) = match connect_async(request).await {
        Ok(stream) => stream,
        Err(error) if opened_target.route_token.is_some() => {
            let direct_error = error.to_string();
            let fallback = cloud_mcp_fallback_ws_target(&cloud_mcp_base_url(), "/v1/voice-agent/ws");
            let fallback_request = match cloud_voice_agent_ws_request(
                &fallback,
                auth_bearer.as_deref(),
                &workspace_id,
                &repo_id,
            ) {
                Ok(request) => request,
                Err(error) => {
                    let message =
                        format!("Unable to prepare cloud voice agent balancer fallback: {error}");
                    if let Some(ready_tx) = ready_tx.take() {
                        let _ = ready_tx.send(Err(message.clone()));
                    }
                    let _ = finished_tx.send(Err(message));
                    return;
                }
            };
            match connect_async(fallback_request).await {
                Ok(stream) => {
                    opened_target = fallback;
                    stream
                }
                Err(fallback_error) => {
                    let message = format!(
                        "Unable to open cloud voice agent WebSocket via direct route ({direct_error}); fallback via balancer also failed: {fallback_error}"
                    );
                    if let Some(ready_tx) = ready_tx.take() {
                        let _ = ready_tx.send(Err(message.clone()));
                    }
                    let _ = finished_tx.send(Err(message));
                    return;
                }
            }
        }
        Err(error) => {
            let message = format!("Unable to open cloud voice agent WebSocket: {error}");
            if let Some(ready_tx) = ready_tx.take() {
                let _ = ready_tx.send(Err(message.clone()));
            }
            let _ = finished_tx.send(Err(message));
            return;
        }
    };
    let (mut write, mut read) = ws_stream.split();
    if let Err(error) = write
        .send(Message::Text(start_request.to_string().into()))
        .await
    {
        let message = format!("Unable to start cloud voice agent stream: {error}");
        if let Some(ready_tx) = ready_tx.take() {
            let _ = ready_tx.send(Err(message.clone()));
        }
        let _ = finished_tx.send(Err(message));
        return;
    }

    let start_deadline = sleep(Duration::from_secs(DEEPGRAM_CONNECT_TIMEOUT_SECS));
    tokio::pin!(start_deadline);
    loop {
        tokio::select! {
            maybe_message = read.next() => {
                match maybe_message {
                    Some(Ok(Message::Ping(payload))) => {
                        if let Err(error) = write.send(Message::Pong(payload)).await {
                            let message = format!("Unable to answer cloud voice agent ping before stream start: {error}");
                            if let Some(ready_tx) = ready_tx.take() {
                                let _ = ready_tx.send(Err(message.clone()));
                            }
                            let _ = finished_tx.send(Err(message));
                            return;
                        }
                    }
                    Some(Ok(message)) => {
                        if let Some(payload) = cloud_voice_agent_payload_from_ws_message(&message) {
                            let kind = cloud_voice_agent_event_kind(&payload).to_string();
                            emit_cloud_voice_agent_event(&app, payload.clone());
                            if let Some(error) = cloud_voice_agent_error_message(&payload) {
                                let message = format!("Cloud voice agent could not start audio stream: {error}");
                                if let Some(ready_tx) = ready_tx.take() {
                                    let _ = ready_tx.send(Err(message.clone()));
                                }
                                let _ = finished_tx.send(Err(message));
                                return;
                            }
                            if kind == "voice_agent_stream_started" {
                                if let Some(ready_tx) = ready_tx.take() {
                                    let _ = ready_tx.send(Ok(()));
                                }
                                break;
                            }
                        } else if matches!(message, Message::Close(_)) {
                            let message = "Cloud voice agent closed before the audio stream started.".to_string();
                            if let Some(ready_tx) = ready_tx.take() {
                                let _ = ready_tx.send(Err(message.clone()));
                            }
                            let _ = finished_tx.send(Err(message));
                            return;
                        }
                    }
                    Some(Err(error)) => {
                        let message = format!("Cloud voice agent stream failed before it started: {error}");
                        if let Some(ready_tx) = ready_tx.take() {
                            let _ = ready_tx.send(Err(message.clone()));
                        }
                        let _ = finished_tx.send(Err(message));
                        return;
                    }
                    None => {
                        let message = "Cloud voice agent websocket closed before the audio stream started.".to_string();
                        if let Some(ready_tx) = ready_tx.take() {
                            let _ = ready_tx.send(Err(message.clone()));
                        }
                        let _ = finished_tx.send(Err(message));
                        return;
                    }
                }
            }
            maybe_control = control_rx.recv() => {
                if matches!(maybe_control, Some(CloudVoiceAgentControl::Stop) | None) {
                    let message = "Cloud voice agent stream was stopped before it started.".to_string();
                    if let Some(ready_tx) = ready_tx.take() {
                        let _ = ready_tx.send(Err(message.clone()));
                    }
                    let _ = finished_tx.send(Ok(()));
                    return;
                }
            }
            _ = &mut start_deadline => {
                let message = "Cloud voice agent timed out while starting the audio stream.".to_string();
                if let Some(ready_tx) = ready_tx.take() {
                    let _ = ready_tx.send(Err(message.clone()));
                }
                let _ = finished_tx.send(Err(message));
                return;
            }
        }
    }

    log_audio_diagnostic_event(
        "audio.cloud_voice.start.done",
        json!({
            "repo_id": repo_id,
            "sample_rate": sample_rate,
            "workspace_id": workspace_id,
            "transport": opened_target.transport,
            "direct": opened_target.route_token.is_some(),
        }),
    );

    let mut stream_error: Option<String> = None;
    let mut client_stop_requested = false;
    let mut input_finished_sent = false;
    let mut result_received = false;
    let mut tts_suppression_until: Option<Instant> = None;
    let mut suppressed_audio_chunks = 0u64;
    let mut suppressed_audio_bytes = 0u64;
    loop {
        tokio::select! {
            maybe_control = control_rx.recv() => {
                match maybe_control {
                    Some(CloudVoiceAgentControl::FinishInput) => {
                        if !input_finished_sent {
                            let finish_message = json!({
                                "kind": "finish_input",
                                "contract": "diffforge.voice_agent.v1",
                            });
                            if let Err(error) = write
                                .send(Message::Text(finish_message.to_string().into()))
                                .await
                            {
                                stream_error = Some(format!(
                                    "Unable to finish cloud voice agent input: {error}"
                                ));
                            } else {
                                input_finished_sent = true;
                                log_audio_diagnostic_event(
                                    "audio.cloud_voice.finish_input.sent",
                                    json!({
                                        "repo_id": repo_id,
                                        "workspace_id": workspace_id,
                                    }),
                                );
                            }
                        }
                        break;
                    }
                    Some(CloudVoiceAgentControl::Stop) | None => {
                        client_stop_requested = true;
                        break;
                    }
                }
            }
            maybe_audio = audio_rx.recv() => {
                let Some(audio_bytes) = maybe_audio else {
                    match control_rx.try_recv() {
                        Ok(CloudVoiceAgentControl::Stop)
                        | Err(mpsc::error::TryRecvError::Disconnected) => {
                            client_stop_requested = true;
                            break;
                        }
                        Ok(CloudVoiceAgentControl::FinishInput)
                        | Err(mpsc::error::TryRecvError::Empty) => {}
                    }
                    if !input_finished_sent {
                        let finish_message = json!({
                            "kind": "finish_input",
                            "contract": "diffforge.voice_agent.v1",
                        });
                        if let Err(error) = write
                            .send(Message::Text(finish_message.to_string().into()))
                            .await
                        {
                            stream_error = Some(format!(
                                "Unable to finish cloud voice agent input after audio closed: {error}"
                            ));
                        } else {
                            input_finished_sent = true;
                            log_audio_diagnostic_event(
                                "audio.cloud_voice.finish_input.sent",
                                json!({
                                    "reason": "audio_channel_closed",
                                    "repo_id": repo_id,
                                    "workspace_id": workspace_id,
                                }),
                            );
                        }
                    }
                    break;
                };
                if !audio_bytes.is_empty() {
                    if cloud_voice_agent_tts_suppression_active(tts_suppression_until) {
                        suppressed_audio_chunks += 1;
                        suppressed_audio_bytes += audio_bytes.len() as u64;
                        continue;
                    }
                    if suppressed_audio_chunks > 0 {
                        log_audio_diagnostic_event(
                            "audio.cloud_voice.tts_echo_suppressed",
                            json!({
                                "bytes": suppressed_audio_bytes,
                                "chunks": suppressed_audio_chunks,
                                "repo_id": repo_id,
                                "workspace_id": workspace_id,
                            }),
                        );
                        suppressed_audio_chunks = 0;
                        suppressed_audio_bytes = 0;
                    }
                    tts_suppression_until = None;
                    if let Err(error) = write.send(Message::Binary(audio_bytes.into())).await {
                        stream_error = Some(
                            cloud_voice_agent_pending_error_message(&mut read)
                                .await
                                .unwrap_or_else(|| {
                                    format!(
                                        "Unable to stream audio to cloud voice agent: {error}"
                                    )
                                }),
                        );
                        break;
                    }
                }
            }
            maybe_message = read.next() => {
                match maybe_message {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(payload) = serde_json::from_str::<Value>(text.as_str()) {
                            let request_complete = cloud_voice_agent_event_completes_request(&payload);
                            update_cloud_voice_agent_tts_suppression(
                                &payload,
                                &mut tts_suppression_until,
                            );
                            emit_cloud_voice_agent_event(&app, payload);
                            if request_complete {
                                result_received = true;
                                break;
                            }
                        }
                    }
                    Some(Ok(Message::Binary(bytes))) => {
                        if let Ok(text) = String::from_utf8(bytes.to_vec()) {
                            if let Ok(payload) = serde_json::from_str::<Value>(&text) {
                                let request_complete =
                                    cloud_voice_agent_event_completes_request(&payload);
                                update_cloud_voice_agent_tts_suppression(
                                    &payload,
                                    &mut tts_suppression_until,
                                );
                                emit_cloud_voice_agent_event(&app, payload);
                                if request_complete {
                                    result_received = true;
                                    break;
                                }
                            }
                        }
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        if let Err(error) = write.send(Message::Pong(payload)).await {
                            stream_error = Some(format!("Unable to answer cloud voice agent ping: {error}"));
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(error)) => {
                        let error_text = error.to_string();
                        if client_stop_requested && is_expected_cloud_voice_agent_close_error(&error_text) {
                            break;
                        }
                        stream_error = Some(format!("Cloud voice agent stream failed: {error_text}"));
                        break;
                    }
                    _ => {}
                }
            }
        }
    }

    if stream_error.is_none() && !client_stop_requested && !result_received {
        if !input_finished_sent {
            let finish_message = json!({
                "kind": "finish_input",
                "contract": "diffforge.voice_agent.v1",
            });
            if let Err(error) = write
                .send(Message::Text(finish_message.to_string().into()))
                .await
            {
                stream_error = Some(format!(
                    "Unable to finish cloud voice agent input before waiting for result: {error}"
                ));
            } else {
                log_audio_diagnostic_event(
                    "audio.cloud_voice.finish_input.sent",
                    json!({
                        "reason": "result_wait_started",
                        "repo_id": repo_id,
                        "workspace_id": workspace_id,
                    }),
                );
            }
        }
    }

    if stream_error.is_none() && !client_stop_requested && !result_received {
        log_audio_diagnostic_event(
            "audio.cloud_voice.result_wait.start",
            json!({
                "repo_id": repo_id,
                "timeout_secs": CLOUD_VOICE_AGENT_RESULT_TIMEOUT_SECS,
                "workspace_id": workspace_id,
            }),
        );
        let result_deadline = sleep(Duration::from_secs(CLOUD_VOICE_AGENT_RESULT_TIMEOUT_SECS));
        tokio::pin!(result_deadline);
        loop {
            tokio::select! {
                maybe_control = control_rx.recv() => {
                    if matches!(maybe_control, Some(CloudVoiceAgentControl::Stop) | None) {
                        client_stop_requested = true;
                        break;
                    }
                }
                maybe_message = read.next() => {
                    match maybe_message {
                        Some(Ok(Message::Text(text))) => {
                            if let Ok(payload) = serde_json::from_str::<Value>(text.as_str()) {
                                let request_complete =
                                    cloud_voice_agent_event_completes_request(&payload);
                                update_cloud_voice_agent_tts_suppression(
                                    &payload,
                                    &mut tts_suppression_until,
                                );
                                emit_cloud_voice_agent_event(&app, payload);
                                if request_complete {
                                    result_received = true;
                                    break;
                                }
                            }
                        }
                        Some(Ok(Message::Binary(bytes))) => {
                            if let Ok(text) = String::from_utf8(bytes.to_vec()) {
                                if let Ok(payload) = serde_json::from_str::<Value>(&text) {
                                    let request_complete =
                                        cloud_voice_agent_event_completes_request(&payload);
                                    update_cloud_voice_agent_tts_suppression(
                                        &payload,
                                        &mut tts_suppression_until,
                                    );
                                    emit_cloud_voice_agent_event(&app, payload);
                                    if request_complete {
                                        result_received = true;
                                        break;
                                    }
                                }
                            }
                        }
                        Some(Ok(Message::Ping(payload))) => {
                            if let Err(error) = write.send(Message::Pong(payload)).await {
                                stream_error =
                                    Some(format!("Unable to answer cloud voice agent ping: {error}"));
                                break;
                            }
                        }
                        Some(Ok(Message::Close(_))) | None => {
                            stream_error = Some(
                                "Cloud voice agent connection closed before final response, plan, or error."
                                    .to_string(),
                            );
                            break;
                        }
                        Some(Err(error)) => {
                            let error_text = error.to_string();
                            stream_error = Some(format!(
                                "Cloud voice agent stream failed: {error_text}"
                            ));
                            break;
                        }
                        _ => {}
                    }
                }
                _ = &mut result_deadline => {
                    stream_error = Some(format!(
                        "Cloud voice agent did not return a final response, plan, or error within {CLOUD_VOICE_AGENT_RESULT_TIMEOUT_SECS} seconds after input finished."
                    ));
                    break;
                }
            }
        }
        log_audio_diagnostic_event(
            "audio.cloud_voice.result_wait.done",
            json!({
                "error": stream_error.as_deref().unwrap_or_default(),
                "received": result_received,
                "repo_id": repo_id,
                "workspace_id": workspace_id,
            }),
        );
    }

    let stop_message = json!({
        "kind": "stop",
        "contract": "diffforge.voice_agent.v1",
    });
    if let Err(error) = write
        .send(Message::Text(stop_message.to_string().into()))
        .await
    {
        let error_text = error.to_string();
        if stream_error.is_none()
            && !(client_stop_requested && is_expected_cloud_voice_agent_close_error(&error_text))
        {
            stream_error = Some(format!(
                "Unable to stop cloud voice agent stream: {error_text}"
            ));
        }
    }

    if stream_error.is_none() {
        loop {
            match timeout(
                Duration::from_secs(DEEPGRAM_CLOSE_TIMEOUT_SECS),
                read.next(),
            )
            .await
            {
                Ok(Some(Ok(Message::Text(text)))) => {
                    if let Ok(payload) = serde_json::from_str::<Value>(text.as_str()) {
                        update_cloud_voice_agent_tts_suppression(
                            &payload,
                            &mut tts_suppression_until,
                        );
                        emit_cloud_voice_agent_event(&app, payload);
                    }
                }
                Ok(Some(Ok(Message::Binary(bytes)))) => {
                    if let Ok(text) = String::from_utf8(bytes.to_vec()) {
                        if let Ok(payload) = serde_json::from_str::<Value>(&text) {
                            update_cloud_voice_agent_tts_suppression(
                                &payload,
                                &mut tts_suppression_until,
                            );
                            emit_cloud_voice_agent_event(&app, payload);
                        }
                    }
                }
                Ok(Some(Ok(Message::Ping(payload)))) => {
                    if let Err(error) = write.send(Message::Pong(payload)).await {
                        stream_error =
                            Some(format!("Unable to answer cloud voice agent ping: {error}"));
                        break;
                    }
                }
                Ok(Some(Ok(Message::Close(_)))) | Ok(None) | Err(_) => break,
                Ok(Some(Err(error))) => {
                    let error_text = error.to_string();
                    if client_stop_requested
                        && is_expected_cloud_voice_agent_close_error(&error_text)
                    {
                        break;
                    }
                    stream_error = Some(format!("Cloud voice agent stream failed: {error_text}"));
                    break;
                }
                _ => {}
            }
        }
    }

    if let Some(error) = stream_error {
        emit_cloud_voice_agent_event(
            &app,
            json!({
                "kind": "voice_agent_error",
                "contract": "diffforge.voice_agent.v1",
                "error": {
                    "code": "desktop_cloud_voice_stream_failed",
                    "message": error.clone(),
                },
            }),
        );
        let _ = finished_tx.send(Err(error));
    } else {
        let _ = finished_tx.send(Ok(()));
    }
}

async fn run_cloud_voice_agent_text_message(
    app: AppHandle,
    ws_target: CloudMcpWsTarget,
    auth_bearer: Option<String>,
    text_request: Value,
    workspace_id: String,
    repo_id: String,
    ready_tx: oneshot::Sender<Result<(), String>>,
) {
    let mut opened_target = ws_target.clone();
    let request = match cloud_voice_agent_ws_request(
        &opened_target,
        auth_bearer.as_deref(),
        &workspace_id,
        &repo_id,
    ) {
        Ok(request) => request,
        Err(error) => {
            let _ = ready_tx.send(Err(error));
            return;
        }
    };

    let (ws_stream, _) = match connect_async(request).await {
        Ok(stream) => stream,
        Err(error) if opened_target.route_token.is_some() => {
            let direct_error = error.to_string();
            let fallback = cloud_mcp_fallback_ws_target(&cloud_mcp_base_url(), "/v1/voice-agent/ws");
            let fallback_request = match cloud_voice_agent_ws_request(
                &fallback,
                auth_bearer.as_deref(),
                &workspace_id,
                &repo_id,
            ) {
                Ok(request) => request,
                Err(error) => {
                    let message =
                        format!("Unable to prepare cloud voice agent chat balancer fallback: {error}");
                    let _ = ready_tx.send(Err(message));
                    return;
                }
            };
            match connect_async(fallback_request).await {
                Ok(stream) => {
                    opened_target = fallback;
                    stream
                }
                Err(fallback_error) => {
                    let message = format!(
                        "Unable to open cloud voice agent chat WebSocket via direct route ({direct_error}); fallback via balancer also failed: {fallback_error}"
                    );
                    let _ = ready_tx.send(Err(message));
                    return;
                }
            }
        }
        Err(error) => {
            let message = format!("Unable to open cloud voice agent chat WebSocket: {error}");
            let _ = ready_tx.send(Err(message));
            return;
        }
    };
    let (mut write, mut read) = ws_stream.split();
    if let Err(error) = write
        .send(Message::Text(text_request.to_string().into()))
        .await
    {
        let message = format!("Unable to send cloud voice agent chat message: {error}");
        let _ = ready_tx.send(Err(message));
        return;
    }
    let _ = ready_tx.send(Ok(()));

    log_audio_diagnostic_event(
        "audio.cloud_voice.text_message.sent",
        json!({
            "repo_id": repo_id,
            "workspace_id": workspace_id,
            "transport": opened_target.transport,
            "direct": opened_target.route_token.is_some(),
        }),
    );

    let mut stream_error: Option<String> = None;
    let mut result_received = false;
    let mut tts_suppression_until: Option<Instant> = None;
    let result_deadline = sleep(Duration::from_secs(CLOUD_VOICE_AGENT_RESULT_TIMEOUT_SECS));
    tokio::pin!(result_deadline);

    loop {
        tokio::select! {
            maybe_message = read.next() => {
                match maybe_message {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(payload) = serde_json::from_str::<Value>(text.as_str()) {
                            let request_complete =
                                cloud_voice_agent_event_completes_request(&payload);
                            update_cloud_voice_agent_tts_suppression(
                                &payload,
                                &mut tts_suppression_until,
                            );
                            emit_cloud_voice_agent_event(&app, payload);
                            if request_complete {
                                result_received = true;
                                break;
                            }
                        }
                    }
                    Some(Ok(Message::Binary(bytes))) => {
                        if let Ok(text) = String::from_utf8(bytes.to_vec()) {
                            if let Ok(payload) = serde_json::from_str::<Value>(&text) {
                                let request_complete =
                                    cloud_voice_agent_event_completes_request(&payload);
                                update_cloud_voice_agent_tts_suppression(
                                    &payload,
                                    &mut tts_suppression_until,
                                );
                                emit_cloud_voice_agent_event(&app, payload);
                                if request_complete {
                                    result_received = true;
                                    break;
                                }
                            }
                        }
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        if let Err(error) = write.send(Message::Pong(payload)).await {
                            stream_error =
                                Some(format!("Unable to answer cloud voice agent ping: {error}"));
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        stream_error = Some(
                            "Cloud voice agent chat connection closed before final response, plan, or error."
                                .to_string(),
                        );
                        break;
                    }
                    Some(Err(error)) => {
                        stream_error = Some(format!(
                            "Cloud voice agent chat failed: {}",
                            error
                        ));
                        break;
                    }
                    _ => {}
                }
            }
            _ = &mut result_deadline => {
                stream_error = Some(format!(
                    "Cloud voice agent chat did not return a final response, plan, or error within {CLOUD_VOICE_AGENT_RESULT_TIMEOUT_SECS} seconds."
                ));
                break;
            }
        }
    }

    if result_received {
        let stop_message = json!({
            "kind": "stop",
            "contract": "diffforge.voice_agent.v1",
        });
        let _ = write
            .send(Message::Text(stop_message.to_string().into()))
            .await;
    }

    if let Some(error) = stream_error {
        emit_cloud_voice_agent_event(
            &app,
            json!({
                "kind": "voice_agent_error",
                "contract": "diffforge.voice_agent.v1",
                "error": {
                    "code": "desktop_cloud_voice_chat_failed",
                    "message": error,
                },
            }),
        );
    }
}

#[tauri::command]
async fn start_cloud_voice_agent_stream(
    app: AppHandle,
    audio_state: State<'_, AudioState>,
    cloud_mcp_state: State<'_, CloudMcpState>,
    request: CloudVoiceAgentStartRequest,
) -> Result<CloudVoiceAgentStartStatus, String> {
    log_audio_diagnostic_event("audio.cloud_voice.start.command", json!({}));
    let _realtime_guard = audio_state.realtime_stream_lock.lock().await;
    let mut session_guard = audio_state.cloud_voice_agent_stream.lock().await;
    if session_guard.is_some() {
        return Err("Cloud voice agent stream is already active.".to_string());
    }
    if audio_state.deepgram_stream.lock().await.is_some() {
        return Err("Deepgram realtime transcription is already active.".to_string());
    }

    let CloudVoiceAgentStartRequest {
        repo_id,
        agent_statuses,
        workspace_id,
        workspace_name,
        workspace_root,
    } = request;
    let workspace_id = clean_cloud_voice_agent_text(workspace_id, 120);
    let workspace_name = clean_cloud_voice_agent_text(workspace_name, 240);
    let workspace_root = clean_cloud_voice_agent_text(workspace_root, 2048);
    let resolved_workspace_root = if workspace_root.is_empty() {
        resolve_workspace_root_directory(None)?
    } else {
        resolve_workspace_root_directory(Some(&workspace_root))?
    };
    let workspace_root = workspace_path_display(&resolved_workspace_root);
    let repo_id = clean_cloud_voice_agent_text(repo_id, 160);
    let repo_id = if !repo_id.is_empty() {
        repo_id
    } else {
        cloud_mcp_repo_id_for_root(&resolved_workspace_root)
    };
    let agent_statuses = agent_statuses.unwrap_or_else(|| json!([]));

    let (audio_tx, audio_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let status = audio_state.input_worker.attach_realtime_stream(audio_tx)?;
    let start_request = json!({
        "kind": "start",
        "contract": "diffforge.voice_agent.v1",
        "workspace_id": workspace_id,
        "workspace_name": workspace_name,
        "workspace_root": workspace_root,
        "repo_id": repo_id,
        "agent_statuses": agent_statuses,
        "fast_response_policy": {
            "enabled": true,
            "required": true,
            "generate": "llm",
            "hold_ms": CLOUD_VOICE_AGENT_FAST_RESPONSE_HOLD_MS,
            "emit_immediately": true,
            "release": "immediate",
            "also_emit_main_response": true,
            "tts": {
                "provider": "deepgram_aura",
                "stream": true,
            },
            "event_contract": {
                "fast_flag": "fast_response",
                "feedback_kind": "voice_agent_fast_llm_feedback",
            },
        },
        "llm_orchestrator_policy": {
            "mode": "respond_or_create_plan",
            "disable_search": true,
            "disabled_tools": [
                "search",
                "web_search",
                "web_search_preview",
                "browser_search",
                "file_search"
            ],
            "allowed_tools": ["create_plan", "open_coding_agents"],
            "tool_choice": "auto",
            "response_contract": {
                "immediate_feedback_required": true,
                "main_response_required": true,
                "main_response_may_call_tool": true,
                "regular_response_kind": "voice_agent_llm_feedback",
                "plan_tool_name": "create_plan",
                "agent_open_tool_name": "open_coding_agents",
                "plan_snapshot_kind": "voice_agent_plan_snapshot"
            }
        },
        "audio": {
            "encoding": "linear16",
            "sample_rate": status.sample_rate,
            "channels": 1,
        },
    });
    let (ready_tx, ready_rx) = oneshot::channel();
    let (finished_tx, finished_rx) = oneshot::channel();
    let (control_tx, control_rx) = mpsc::unbounded_channel::<CloudVoiceAgentControl>();
    let auth_bearer = cloud_mcp_authorization_bearer(cloud_mcp_state.inner()).await?;
    let ws_target = cloud_mcp_resolve_ws_target(
        cloud_mcp_state.inner(),
        &cloud_mcp_base_url(),
        "/v1/voice-agent/ws",
    )
    .await;
    tauri::async_runtime::spawn(run_cloud_voice_agent_stream(
        app,
        ws_target,
        auth_bearer,
        start_request,
        workspace_id.clone(),
        repo_id.clone(),
        status.sample_rate,
        audio_rx,
        control_rx,
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
            return Err("Cloud voice agent stream closed before it was ready.".to_string());
        }
        Err(_elapsed) => {
            let _ = audio_state.input_worker.detach_realtime_stream();
            return Err("Cloud voice agent stream timed out while connecting.".to_string());
        }
    }

    *session_guard = Some(CloudVoiceAgentSession {
        control_tx,
        finished_rx,
    });

    Ok(CloudVoiceAgentStartStatus {
        active: true,
        repo_id,
        sample_rate: status.sample_rate,
        workspace_id,
    })
}

#[tauri::command]
async fn send_cloud_voice_agent_text_message(
    app: AppHandle,
    audio_state: State<'_, AudioState>,
    cloud_mcp_state: State<'_, CloudMcpState>,
    request: CloudVoiceAgentTextMessageRequest,
) -> Result<(), String> {
    log_audio_diagnostic_event("audio.cloud_voice.text_message.command", json!({}));
    let _realtime_guard = audio_state.realtime_stream_lock.lock().await;
    if audio_state.cloud_voice_agent_stream.lock().await.is_some() {
        return Err("Cloud voice agent stream is already active.".to_string());
    }
    if audio_state.deepgram_stream.lock().await.is_some() {
        return Err("Deepgram realtime transcription is already active.".to_string());
    }

    let CloudVoiceAgentTextMessageRequest {
        text,
        turn_index,
        repo_id,
        agent_statuses,
        workspace_id,
        workspace_name,
        workspace_root,
    } = request;
    let text = clean_cloud_voice_agent_message_text(text, 12_000);
    if text.is_empty() {
        return Err("Message is empty.".to_string());
    }
    let workspace_id = clean_cloud_voice_agent_text(workspace_id, 120);
    let workspace_name = clean_cloud_voice_agent_text(workspace_name, 240);
    let workspace_root = clean_cloud_voice_agent_text(workspace_root, 2048);
    let resolved_workspace_root = if workspace_root.is_empty() {
        resolve_workspace_root_directory(None)?
    } else {
        resolve_workspace_root_directory(Some(&workspace_root))?
    };
    let workspace_root = workspace_path_display(&resolved_workspace_root);
    let repo_id = clean_cloud_voice_agent_text(repo_id, 160);
    let repo_id = if !repo_id.is_empty() {
        repo_id
    } else {
        cloud_mcp_repo_id_for_root(&resolved_workspace_root)
    };
    let agent_statuses = agent_statuses.unwrap_or_else(|| json!([]));
    let text_request = json!({
        "kind": "text_message",
        "contract": "diffforge.voice_agent.v1",
        "text": text,
        "turn_index": turn_index.unwrap_or(0),
        "workspace_id": workspace_id.clone(),
        "workspace_name": workspace_name,
        "workspace_root": workspace_root,
        "repo_id": repo_id.clone(),
        "agent_statuses": agent_statuses,
        "llm_orchestrator_policy": cloud_voice_agent_llm_orchestrator_policy(),
    });
    let (ready_tx, ready_rx) = oneshot::channel();
    let auth_bearer = cloud_mcp_authorization_bearer(cloud_mcp_state.inner()).await?;
    let ws_target = cloud_mcp_resolve_ws_target(
        cloud_mcp_state.inner(),
        &cloud_mcp_base_url(),
        "/v1/voice-agent/ws",
    )
    .await;
    tauri::async_runtime::spawn(run_cloud_voice_agent_text_message(
        app,
        ws_target,
        auth_bearer,
        text_request,
        workspace_id,
        repo_id,
        ready_tx,
    ));

    match timeout(Duration::from_secs(DEEPGRAM_CONNECT_TIMEOUT_SECS), ready_rx).await {
        Ok(Ok(Ok(()))) => Ok(()),
        Ok(Ok(Err(error))) => Err(error),
        Ok(Err(_closed)) => Err("Cloud voice agent chat closed before it was ready.".to_string()),
        Err(_elapsed) => Err("Cloud voice agent chat timed out while connecting.".to_string()),
    }
}

#[tauri::command]
async fn stop_cloud_voice_agent_stream(audio_state: State<'_, AudioState>) -> Result<(), String> {
    log_audio_diagnostic_event("audio.cloud_voice.stop.command", json!({}));
    let _realtime_guard = audio_state.realtime_stream_lock.lock().await;
    let session = {
        let mut session_guard = audio_state.cloud_voice_agent_stream.lock().await;
        session_guard.take()
    };
    let Some(session) = session else {
        log_audio_diagnostic_event("audio.cloud_voice.stop.inactive", json!({}));
        return Ok(());
    };

    let _ = session.control_tx.send(CloudVoiceAgentControl::Stop);
    audio_state.input_worker.detach_realtime_stream()?;

    timeout(
        Duration::from_secs(DEEPGRAM_CLOSE_TIMEOUT_SECS),
        session.finished_rx,
    )
    .await
    .map_err(|_| "Cloud voice agent stream timed out while stopping.".to_string())?
    .map_err(|_| "Cloud voice agent stream stopped before it returned.".to_string())??;
    log_audio_diagnostic_event("audio.cloud_voice.stop.done", json!({}));
    Ok(())
}

#[tauri::command]
async fn finish_cloud_voice_agent_input(audio_state: State<'_, AudioState>) -> Result<(), String> {
    log_audio_diagnostic_event("audio.cloud_voice.finish_input.command", json!({}));
    let _realtime_guard = audio_state.realtime_stream_lock.lock().await;
    let control_tx = {
        let session_guard = audio_state.cloud_voice_agent_stream.lock().await;
        let Some(session) = session_guard.as_ref() else {
            log_audio_diagnostic_event("audio.cloud_voice.finish_input.inactive", json!({}));
            return Ok(());
        };
        session.control_tx.clone()
    };

    let _ = control_tx.send(CloudVoiceAgentControl::FinishInput);
    audio_state.input_worker.detach_realtime_stream()?;
    log_audio_diagnostic_event("audio.cloud_voice.finish_input.done", json!({}));
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
            match timeout(
                Duration::from_secs(DEEPGRAM_CLOSE_TIMEOUT_SECS),
                read.next(),
            )
            .await
            {
                Ok(Some(Ok(message))) => {
                    match handle_deepgram_realtime_message(
                        &app,
                        message,
                        &mut final_segments,
                        &mut latest_interim,
                    ) {
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
        if transcript.trim().is_empty() {
            0
        } else {
            1
        }
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
    log_audio_diagnostic_event(
        "audio.deepgram.start.command",
        json!({
            "language": request.language.clone(),
            "has_api_key": !request.api_key.trim().is_empty(),
        }),
    );
    let api_key = clean_deepgram_api_key(&request.api_key)?;
    let language = clean_deepgram_language(request.language)?;
    let _realtime_guard = audio_state.realtime_stream_lock.lock().await;
    let mut session_guard = audio_state.deepgram_stream.lock().await;

    if session_guard.is_some() {
        return Err("Deepgram realtime transcription is already active.".to_string());
    }
    if audio_state.cloud_voice_agent_stream.lock().await.is_some() {
        return Err("Cloud voice agent stream is already active.".to_string());
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

    log_audio_diagnostic_event(
        "audio.deepgram.start.done",
        json!({
            "language": language,
            "sample_rate": status.sample_rate,
        }),
    );

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
    log_audio_diagnostic_event("audio.deepgram.stop.command", json!({}));
    let _realtime_guard = audio_state.realtime_stream_lock.lock().await;
    let session = {
        let mut session_guard = audio_state.deepgram_stream.lock().await;
        session_guard.take()
    };
    let Some(session) = session else {
        log_audio_diagnostic_event("audio.deepgram.stop.inactive", json!({}));
        return Ok(WhisperTranscriptionResult {
            text: String::new(),
            segments: 0,
            duration_ms: 0,
        });
    };

    audio_state.input_worker.detach_realtime_stream()?;

    let result = timeout(
        Duration::from_secs(DEEPGRAM_TRANSCRIBE_TIMEOUT_SECS),
        session.finished_rx,
    )
    .await
    .map_err(|_| "Deepgram realtime transcription timed out.".to_string())?
    .map_err(|_| {
        "Deepgram realtime transcription stopped before a result was returned.".to_string()
    })??;
    log_audio_diagnostic_event(
        "audio.deepgram.stop.done",
        json!({
            "text_chars": result.text.chars().count(),
            "segments": result.segments,
            "duration_ms": result.duration_ms,
        }),
    );
    Ok(result)
}

#[tauri::command]
async fn audio_widget_status(app: AppHandle) -> Result<AudioWidgetVisibility, String> {
    log_audio_diagnostic_event("audio.widget.status.command", json!({}));
    audio_widget_status_for(&app)
}

#[tauri::command]
async fn show_audio_widget(
    app: AppHandle,
    audio_state: State<'_, AudioState>,
) -> Result<AudioWidgetVisibility, String> {
    log_audio_diagnostic_event("audio.widget.show.command", json!({}));
    let visibility = show_audio_widget_for(&app)?;
    let prepare_app = app.clone();
    let engine = audio_state.whisper_engine.clone();

    if visibility.installed {
        log_audio_diagnostic_event("audio.widget.show.prepare_spawn", json!({}));
        let _ = tauri::async_runtime::spawn_blocking(move || {
            match prepare_whisper_model_for(&prepare_app, &engine) {
                Ok(status) => log_audio_diagnostic_event(
                    "audio.widget.show.prepare_done",
                    json!({
                        "cached": status.cached,
                        "elapsed_ms": status.elapsed_ms,
                    }),
                ),
                Err(error) => log_audio_diagnostic_event(
                    "audio.widget.show.prepare_error",
                    json!({
                        "error": clean_whisper_local_audio_log_text(&error),
                    }),
                ),
            }
        });
    }

    Ok(visibility)
}

#[tauri::command]
async fn hide_audio_widget(app: AppHandle) -> Result<AudioWidgetVisibility, String> {
    log_audio_diagnostic_event("audio.widget.hide.command", json!({}));
    hide_audio_widget_for(&app)
}

#[tauri::command]
async fn toggle_audio_widget(
    app: AppHandle,
    audio_state: State<'_, AudioState>,
) -> Result<AudioWidgetVisibility, String> {
    log_audio_diagnostic_event("audio.widget.toggle.command", json!({}));
    let visibility = toggle_audio_widget_for(&app)?;

    if visibility.visible && visibility.installed {
        let prepare_app = app.clone();
        let engine = audio_state.whisper_engine.clone();
        log_audio_diagnostic_event("audio.widget.toggle.prepare_spawn", json!({}));
        let _ = tauri::async_runtime::spawn_blocking(move || {
            match prepare_whisper_model_for(&prepare_app, &engine) {
                Ok(status) => log_audio_diagnostic_event(
                    "audio.widget.toggle.prepare_done",
                    json!({
                        "cached": status.cached,
                        "elapsed_ms": status.elapsed_ms,
                    }),
                ),
                Err(error) => log_audio_diagnostic_event(
                    "audio.widget.toggle.prepare_error",
                    json!({
                        "error": clean_whisper_local_audio_log_text(&error),
                    }),
                ),
            }
        });
    }

    Ok(visibility)
}

#[tauri::command]
async fn insert_transcribed_text(
    app: AppHandle,
    terminal_state: State<'_, TerminalState>,
    cloud_mcp_state: State<'_, CloudMcpState>,
    text: String,
) -> Result<AudioWidgetVisibility, String> {
    let text = clean_transcript_for_insert(text)?;
    let widget_visible = app
        .get_webview_window(AUDIO_WIDGET_WINDOW_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);

    if write_to_active_terminal_audio_input_target(&app, &terminal_state, &cloud_mcp_state, &text)
        .await?
    {
        return Ok(AudioWidgetVisibility {
            visible: widget_visible,
            installed: whisper_model_status_for(&app)?.installed,
            shortcut: audio_push_to_talk_shortcut_for(&app),
        });
    }

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

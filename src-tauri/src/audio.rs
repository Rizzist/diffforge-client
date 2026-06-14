use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

const CLOUD_VOICE_AGENT_TTS_SUPPRESSION_TAIL_MS: u64 = 2_500;
const CLOUD_VOICE_AGENT_TTS_SUPPRESSION_MAX_MS: u64 = 30_000;
const CLOUD_VOICE_AGENT_FAST_RESPONSE_HOLD_MS: u64 = 0;
const CLOUD_VOICE_AGENT_SERVER_RECONNECT_GRACE_MS: u64 = 15_000;
const CLOUD_VOICE_AGENT_TEXT_CONNECT_TIMEOUT_SECS: u64 = 40;
const CLOUD_VOICE_AGENT_CONTRACT: &str = "diffforge.voice_agent.v1";
const CLOUD_VOICE_AGENT_WS_PATH: &str = "/v1/voice/ws";
const CLOUD_DICTATION_CONTRACT: &str = "diffforge.voice_dictation.v1";
const CLOUD_DICTATION_WS_PATH: &str = "/v1/voice/dictation/ws";
const CLOUD_DICTATION_POLISH_PATH: &str = "/v1/voice/dictation/polish";
const CLOUD_DICTATION_START_TIMEOUT_SECS: u64 = 20;
const CLOUD_DICTATION_RESULT_TIMEOUT_SECS: u64 = 45;
const CLOUD_DICTATION_POLISH_TIMEOUT_SECS: u64 = 20;
// Warm dictation pool: while Diff Forge Cloud dictation is the selected
// provider, a pre-authenticated websocket stays parked on the cloud ready
// frame so press-to-talk skips auth, route resolution, and the TLS/WS
// handshake entirely. The parked socket is kept alive with JSON pings (the
// cloud resets its start deadline on every ping) and is replaced as soon as
// it is claimed or dies, so dictation is always ready to go instantly.
const CLOUD_DICTATION_WARM_PING_SECS: u64 = 8;
const CLOUD_DICTATION_WARM_CONNECT_TIMEOUT_SECS: u64 = 10;
const CLOUD_DICTATION_WARM_READY_TIMEOUT_SECS: u64 = 10;
const CLOUD_DICTATION_WARM_CLAIM_TIMEOUT_MS: u64 = 800;
const CLOUD_DICTATION_WARM_RETRY_MIN_MS: u64 = 1_000;
const CLOUD_DICTATION_WARM_RETRY_MAX_MS: u64 = 30_000;
// Raw-first finalization: the cloud sends `voice_dictation_final` with the
// raw transcript as soon as Deepgram flushes, then streams
// `voice_dictation_cleanup_delta` partials while the LLM pass generates, then
// a `voice_dictation_cleaned` follow-up frame. The client waits this long for
// the cleaned frame before returning raw; each streamed partial proves the
// cleanup is alive and extends the deadline up to the hard cap.
const CLOUD_DICTATION_CLEANED_WAIT_SECS: u64 = 6;
const CLOUD_DICTATION_CLEANED_PROGRESS_EXTEND_SECS: u64 = 3;
const CLOUD_DICTATION_CLEANED_WAIT_CAP_SECS: u64 = 15;
const AUDIO_INPUT_DEVICE_LIST_TIMEOUT_SECS: u64 = 8;
const NATIVE_AUDIO_COMMAND_TIMEOUT_SECS: u64 = 12;
const NATIVE_AUDIO_FINISH_TIMEOUT_SECS: u64 = 30;
// Cold-connect route cache, keyed by websocket path: every successful voice
// route resolve (mostly the dictation warm keeper's) is remembered briefly so
// a cold press-to-talk skips the serial auth + heartbeat + balancer round
// trips it would otherwise pay.
const CLOUD_VOICE_ROUTE_CACHE_TTL_SECS: u64 = 90;

struct ForgeVoiceCachedRoute {
    ws_target: CloudMcpWsTarget,
    auth_bearer: Option<String>,
    resolved_at: Instant,
}

static FORGE_VOICE_ROUTE_CACHE: OnceLock<StdMutex<HashMap<String, ForgeVoiceCachedRoute>>> =
    OnceLock::new();

fn forge_voice_route_cache() -> &'static StdMutex<HashMap<String, ForgeVoiceCachedRoute>> {
    FORGE_VOICE_ROUTE_CACHE.get_or_init(|| StdMutex::new(HashMap::new()))
}

fn forge_voice_route_cache_store(
    ws_path: &str,
    ws_target: &CloudMcpWsTarget,
    auth_bearer: &Option<String>,
) {
    if let Ok(mut cache) = forge_voice_route_cache().lock() {
        cache.insert(
            ws_path.to_string(),
            ForgeVoiceCachedRoute {
                ws_target: ws_target.clone(),
                auth_bearer: auth_bearer.clone(),
                resolved_at: Instant::now(),
            },
        );
    }
}

fn forge_voice_route_cache_fresh(ws_path: &str) -> Option<(CloudMcpWsTarget, Option<String>)> {
    let cache = forge_voice_route_cache().lock().ok()?;
    let cached = cache.get(ws_path)?;
    if cached.resolved_at.elapsed() > Duration::from_secs(CLOUD_VOICE_ROUTE_CACHE_TTL_SECS) {
        return None;
    }
    Some((cached.ws_target.clone(), cached.auth_bearer.clone()))
}

/// Frontend notification for mic arbitration: the voice agent's microphone
/// feed was paused (dictation borrowed the mic) or resumed (dictation ended).
const FORGE_VOICE_AGENT_MIC_EVENT: &str = "forge-voice-agent-mic";
const AUDIO_WIDGET_SPACE_CHANGED_EVENT: &str = "forge-audio-widget-space-changed";
const AUDIO_WIDGET_BAR_HOVER_CHANGED_EVENT: &str = "forge-audio-widget-bar-hover-changed";
const AUDIO_FORGE_DICTATION_RAW_RESULT_EVENT: &str = "forge-audio-dictation-raw-result";

fn realtime_mic_holder_get(audio_state: &AudioState) -> RealtimeMicHolder {
    audio_state
        .realtime_mic_holder
        .lock()
        .map(|holder| *holder)
        .unwrap_or(RealtimeMicHolder::None)
}

fn realtime_mic_holder_set(audio_state: &AudioState, holder: RealtimeMicHolder) {
    if let Ok(mut slot) = audio_state.realtime_mic_holder.lock() {
        *slot = holder;
    }
}

/// Detaches the realtime microphone outlet only while `path` still owns it.
/// A consumer whose mic was borrowed (or that already released it) must not
/// rip the stream away from the current holder.
fn realtime_mic_detach_for(
    audio_state: &AudioState,
    path: RealtimeMicHolder,
) -> Result<(), String> {
    if realtime_mic_holder_get(audio_state) != path {
        return Ok(());
    }
    realtime_mic_holder_set(audio_state, RealtimeMicHolder::None);
    audio_state.input_worker.detach_realtime_stream()
}

fn emit_voice_agent_mic_event(app: &AppHandle, state: &str, reason: &str) {
    let _ = app.emit(
        FORGE_VOICE_AGENT_MIC_EVENT,
        json!({ "state": state, "reason": reason }),
    );
}

/// Returns the microphone after a dictation session ends (any path): detaches
/// that consumer's feed and, when a live voice agent session lent the mic,
/// quietly re-attaches the agent's audio stream so it resumes listening
/// without a session restart — and without replaying what was dictated
/// meanwhile. Shared by Forge Cloud dictation and the user's own-key Deepgram
/// stream; each runs its own websocket and only arbitrates the one mic here.
async fn realtime_dictation_release_mic(
    app: &AppHandle,
    audio_state: &AudioState,
    holder: RealtimeMicHolder,
    borrowed_flag: &AtomicBool,
) {
    let borrowed = borrowed_flag.swap(false, Ordering::SeqCst);
    if realtime_mic_holder_get(audio_state) != holder {
        return;
    }
    realtime_mic_holder_set(audio_state, RealtimeMicHolder::None);
    let _ = audio_state.input_worker.detach_realtime_stream();
    if !borrowed {
        return;
    }
    if !audio_state
        .cloud_voice_agent_input_enabled
        .load(Ordering::SeqCst)
    {
        log_audio_diagnostic_event(
            "audio.cloud_voice.mic.resume_skipped",
            json!({ "reason": "input_disabled" }),
        );
        return;
    }
    let mut session_guard = audio_state.cloud_voice_agent_stream.lock().await;
    let Some(session) = session_guard.as_mut() else {
        return;
    };
    // The lender finished while dictation held the mic: reap it instead of
    // re-attaching a dead consumer.
    match session.finished_rx.try_recv() {
        Ok(_) | Err(tokio::sync::oneshot::error::TryRecvError::Closed) => {
            *session_guard = None;
            audio_state
                .cloud_voice_agent_input_enabled
                .store(false, Ordering::SeqCst);
            return;
        }
        Err(tokio::sync::oneshot::error::TryRecvError::Empty) => {}
    }
    match audio_state
        .input_worker
        .attach_realtime_stream_silent(session.audio_tx.clone())
    {
        Ok(_) => {
            realtime_mic_holder_set(audio_state, RealtimeMicHolder::VoiceAgent);
            emit_voice_agent_mic_event(app, "resumed", "dictation_finished");
            log_audio_diagnostic_event("audio.cloud_voice.mic.resumed", json!({}));
        }
        Err(error) => {
            log_audio_diagnostic_event(
                "audio.cloud_voice.mic.resume_failed",
                json!({ "error": error }),
            );
        }
    }
}

async fn forge_dictation_release_mic(app: &AppHandle, audio_state: &AudioState) {
    realtime_dictation_release_mic(
        app,
        audio_state,
        RealtimeMicHolder::Dictation,
        &audio_state.forge_dictation_mic_borrowed,
    )
    .await
}

async fn deepgram_release_mic(app: &AppHandle, audio_state: &AudioState) {
    realtime_dictation_release_mic(
        app,
        audio_state,
        RealtimeMicHolder::Deepgram,
        &audio_state.deepgram_mic_borrowed,
    )
    .await
}

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
    write_whisper_local_audio_log_entry(entry);
}

fn write_whisper_local_audio_log_entry(entry: Value) {
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
    let entry = json!({
        "ts_ms": current_time_ms(),
        "phase": clean_whisper_local_audio_log_text(phase),
        "elapsed_ms": elapsed.map(|duration| duration.as_secs_f64() * 1000.0),
        "fields": fields,
    });
    // Capture-session starts always log: they record which capture engine
    // (voice-processing vs raw cpal) the mic is on, the one fact needed to
    // debug echo-cancellation reports from the field.
    if phase.starts_with("audio.monitor.start") {
        write_whisper_local_audio_log_entry(entry);
        return;
    }
    write_whisper_local_audio_log(entry);
}

fn audio_debug_thread_label() -> String {
    let current_thread = thread::current();
    let name = current_thread.name().unwrap_or("unnamed");

    format!("{:?}:{name}", current_thread.id())
}

fn log_audio_diagnostic_event(phase: &str, fields: Value) {
    // Cloud dictation breadcrumbs stay on even in production builds: they are
    // a handful of one-line events per session and the only field telemetry
    // for press-to-talk latency. Everything else honors the debug flag.
    let forced = phase.starts_with("audio.forge_dictation.");
    if !WHISPER_LOCAL_AUDIO_LOGGING_ENABLED && !forced {
        return;
    }
    write_whisper_local_audio_log_entry(json!({
        "ts_ms": current_time_ms(),
        "phase": clean_whisper_local_audio_log_text(phase),
        "elapsed_ms": Value::Null,
        "fields": {
            "app_pid": std::process::id(),
            "thread": audio_debug_thread_label(),
            "fields": fields,
        },
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

/// Keeps the platform capture stream alive for the session's lifetime.
/// macOS prefers the VoiceProcessingIO audio unit: the OS echo canceller
/// subtracts everything the system plays (including the webview's TTS) from
/// the mic signal, so the voice agent can never hear itself.
enum NativeAudioStreamHandle {
    // Held only so Drop tears the capture stream down with the session.
    #[allow(dead_code)]
    Cpal(cpal::Stream),
    #[cfg(target_os = "macos")]
    #[allow(dead_code)]
    VoiceProcessing(MacosVoiceProcessingCapture),
}

struct NativeAudioSession {
    device_id: String,
    label: String,
    owners: HashSet<String>,
    sample_rate: u32,
    shared: Arc<StdMutex<NativeAudioShared>>,
    _stream: NativeAudioStreamHandle,
}

enum NativeAudioCommand {
    AttachRealtime {
        audio_tx: mpsc::UnboundedSender<Vec<u8>>,
        // When false, skip replaying buffered capture-window audio into the
        // new consumer (used when mic arbitration resumes a paused consumer:
        // it must not hear what was spoken while another consumer held the mic).
        replay_buffered: bool,
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
    command_tx: Arc<StdMutex<std::sync::mpsc::Sender<NativeAudioCommand>>>,
}

impl NativeAudioWorker {
    fn new() -> Self {
        Self {
            command_tx: Arc::new(StdMutex::new(Self::spawn_command_tx())),
        }
    }

    fn spawn_command_tx() -> std::sync::mpsc::Sender<NativeAudioCommand> {
        let (command_tx, command_rx) = std::sync::mpsc::channel::<NativeAudioCommand>();

        thread::spawn(move || native_audio_worker_loop(command_rx));

        command_tx
    }

    fn command_tx(&self) -> Result<std::sync::mpsc::Sender<NativeAudioCommand>, String> {
        self.command_tx
            .lock()
            .map(|command_tx| command_tx.clone())
            .map_err(|_| "Native audio worker lock is unavailable.".to_string())
    }

    fn restart_after_timeout(&self, action: &'static str) {
        log_whisper_local_audio_event(
            "audio.worker.restart",
            None,
            json!({
                "reason": "command_timeout",
                "action": action,
            }),
        );

        if let Ok(mut command_tx) = self.command_tx.lock() {
            *command_tx = Self::spawn_command_tx();
        }
    }

    fn run_command_with_timeout<T>(
        &self,
        action: &'static str,
        timeout_duration: Duration,
        command: impl FnOnce(std::sync::mpsc::Sender<Result<T, String>>) -> NativeAudioCommand,
    ) -> Result<T, String> {
        let (response, response_rx) = std::sync::mpsc::channel();
        self.command_tx()?
            .send(command(response))
            .map_err(|_| "Native audio worker is unavailable.".to_string())?;

        match response_rx.recv_timeout(timeout_duration) {
            Ok(result) => result,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                self.restart_after_timeout(action);
                Err("Audio input engine timed out. The mic engine was reset; try again.".to_string())
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                Err("Native audio worker did not respond.".to_string())
            }
        }
    }

    fn attach_realtime_stream(
        &self,
        audio_tx: mpsc::UnboundedSender<Vec<u8>>,
    ) -> Result<AudioInputMonitorStatus, String> {
        self.attach_realtime_stream_with_replay(audio_tx, true)
    }

    /// Attach without replaying buffered capture-window audio: mic
    /// arbitration resume must not feed a paused consumer the speech that was
    /// captured while another consumer held the microphone.
    fn attach_realtime_stream_silent(
        &self,
        audio_tx: mpsc::UnboundedSender<Vec<u8>>,
    ) -> Result<AudioInputMonitorStatus, String> {
        self.attach_realtime_stream_with_replay(audio_tx, false)
    }

    fn attach_realtime_stream_with_replay(
        &self,
        audio_tx: mpsc::UnboundedSender<Vec<u8>>,
        replay_buffered: bool,
    ) -> Result<AudioInputMonitorStatus, String> {
        self.run_command_with_timeout(
            "attach_realtime",
            Duration::from_secs(NATIVE_AUDIO_COMMAND_TIMEOUT_SECS),
            |response| NativeAudioCommand::AttachRealtime {
                audio_tx,
                replay_buffered,
                response,
            },
        )
    }

    fn begin_capture(&self) -> Result<(), String> {
        self.run_command_with_timeout(
            "begin_capture",
            Duration::from_secs(NATIVE_AUDIO_COMMAND_TIMEOUT_SECS),
            |response| NativeAudioCommand::Begin { response },
        )
    }

    fn finish_capture(&self) -> Result<AudioInputCaptureResult, String> {
        self.run_command_with_timeout(
            "finish_capture",
            Duration::from_secs(NATIVE_AUDIO_FINISH_TIMEOUT_SECS),
            |response| NativeAudioCommand::Finish { response },
        )
    }

    fn detach_realtime_stream(&self) -> Result<(), String> {
        self.run_command_with_timeout(
            "detach_realtime",
            Duration::from_secs(NATIVE_AUDIO_COMMAND_TIMEOUT_SECS),
            |response| NativeAudioCommand::DetachRealtime { response },
        )
    }

    fn start_monitor(
        &self,
        app: AppHandle,
        request: AudioInputMonitorRequest,
    ) -> Result<AudioInputMonitorStatus, String> {
        self.run_command_with_timeout(
            "start_monitor",
            Duration::from_secs(NATIVE_AUDIO_COMMAND_TIMEOUT_SECS),
            |response| NativeAudioCommand::Start {
                app,
                request,
                response,
            },
        )
    }

    fn stop_monitor(
        &self,
        request: Option<AudioInputMonitorRequest>,
    ) -> Result<AudioInputMonitorStatus, String> {
        self.run_command_with_timeout(
            "stop_monitor",
            Duration::from_secs(NATIVE_AUDIO_COMMAND_TIMEOUT_SECS),
            |response| NativeAudioCommand::Stop { request, response },
        )
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
            NativeAudioCommand::AttachRealtime {
                audio_tx,
                replay_buffered,
                response,
            } => {
                let result =
                    attach_native_audio_realtime_stream(session.as_ref(), audio_tx, replay_buffered);
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

/// Client-side sample rate requested from the VoiceProcessingIO unit; the
/// unit converts from the device clock, downstream consumers resample again
/// (Whisper to 16 kHz, the cloud agents from the advertised session rate).
#[cfg(target_os = "macos")]
const MACOS_VOICE_PROCESSING_SAMPLE_RATE: u32 = 48_000;

/// True while a VoiceProcessingIO capture session is live. The cloud voice
/// agent checks it to route TTS playback through the unit's own output
/// element instead of the webview, which hands the echo canceller the exact
/// far-end signal.
#[cfg(target_os = "macos")]
static MACOS_VOICE_PROCESSING_ACTIVE: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "macos")]
static MACOS_VOICE_PLAYBACK_QUEUE: OnceLock<Arc<StdMutex<VecDeque<f32>>>> = OnceLock::new();
/// Hard cap on queued native playback (30s at the unit rate) so a runaway
/// stream cannot grow the buffer unbounded.
#[cfg(target_os = "macos")]
const MACOS_VOICE_PLAYBACK_MAX_SAMPLES: usize =
    (MACOS_VOICE_PROCESSING_SAMPLE_RATE as usize) * 30;
/// AUVoiceIO ducking controls are not exposed by coreaudio-rs, but they are
/// documented in AudioToolbox/AudioUnitProperties.h. If these cannot be set,
/// we fall back to raw cpal capture rather than letting macOS attenuate other
/// apps while Diff Forge is listening.
#[cfg(target_os = "macos")]
const MACOS_AU_VOICE_IO_PROPERTY_DUCK_NON_VOICE_AUDIO: u32 = 2102;
#[cfg(target_os = "macos")]
const MACOS_AU_VOICE_IO_PROPERTY_OTHER_AUDIO_DUCKING_CONFIGURATION: u32 = 2108;
#[cfg(target_os = "macos")]
const MACOS_AU_VOICE_IO_OTHER_AUDIO_DUCKING_LEVEL_MIN: u32 = 10;

#[cfg(target_os = "macos")]
#[repr(C)]
struct MacosVoiceIoOtherAudioDuckingConfiguration {
    enable_advanced_ducking: u8,
    ducking_level: u32,
}

#[cfg(target_os = "macos")]
fn macos_voice_playback_queue() -> &'static Arc<StdMutex<VecDeque<f32>>> {
    MACOS_VOICE_PLAYBACK_QUEUE.get_or_init(|| Arc::new(StdMutex::new(VecDeque::new())))
}

#[cfg(target_os = "macos")]
fn macos_voice_playback_clear() {
    if let Ok(mut queue) = macos_voice_playback_queue().lock() {
        queue.clear();
    }
}

/// Converts a linear16 mono TTS chunk to the voice-processing unit's rate
/// and queues it for the render callback.
#[cfg(target_os = "macos")]
fn macos_voice_playback_enqueue_linear16(bytes: &[u8], source_rate: u32) {
    if bytes.len() < 2 || source_rate == 0 {
        return;
    }
    let samples: Vec<f32> = bytes
        .chunks_exact(2)
        .map(|pair| f32::from(i16::from_le_bytes([pair[0], pair[1]])) / 32768.0)
        .collect();
    let target_rate = MACOS_VOICE_PROCESSING_SAMPLE_RATE;
    let resampled = if source_rate == target_rate {
        samples
    } else {
        let output_len = ((samples.len() as u64 * u64::from(target_rate)
            + u64::from(source_rate) / 2)
            / u64::from(source_rate))
        .max(1) as usize;
        let step = f64::from(source_rate) / f64::from(target_rate);
        let mut output = Vec::with_capacity(output_len);
        for index in 0..output_len {
            let position = index as f64 * step;
            let left = (position.floor() as usize).min(samples.len() - 1);
            let right = (left + 1).min(samples.len() - 1);
            let blend = (position - left as f64) as f32;
            output.push(samples[left] + (samples[right] - samples[left]) * blend);
        }
        output
    };
    if let Ok(mut queue) = macos_voice_playback_queue().lock() {
        let room = MACOS_VOICE_PLAYBACK_MAX_SAMPLES.saturating_sub(queue.len());
        queue.extend(resampled.into_iter().take(room));
    }
}

#[cfg(target_os = "macos")]
fn configure_macos_voice_processing_no_ducking(
    unit: &mut coreaudio::audio_unit::AudioUnit,
) -> Result<(), String> {
    use coreaudio::audio_unit::{Element, Scope};

    let ducking_config = MacosVoiceIoOtherAudioDuckingConfiguration {
        enable_advanced_ducking: 0,
        ducking_level: MACOS_AU_VOICE_IO_OTHER_AUDIO_DUCKING_LEVEL_MIN,
    };
    let advanced_result = unit.set_property(
        MACOS_AU_VOICE_IO_PROPERTY_OTHER_AUDIO_DUCKING_CONFIGURATION,
        Scope::Global,
        Element::Output,
        Some(&ducking_config),
    );
    let legacy_disabled: u32 = 0;
    let legacy_result = unit.set_property(
        MACOS_AU_VOICE_IO_PROPERTY_DUCK_NON_VOICE_AUDIO,
        Scope::Global,
        Element::Output,
        Some(&legacy_disabled),
    );

    let advanced_error = advanced_result.as_ref().err().map(ToString::to_string);
    let legacy_error = legacy_result.as_ref().err().map(ToString::to_string);
    log_audio_diagnostic_event(
        "audio.voice_processing.ducking_config",
        json!({
            "advanced_ducking": if advanced_result.is_ok() { "ok" } else { "error" },
            "advanced_error": advanced_error,
            "legacy_ducking": if legacy_result.is_ok() { "ok" } else { "error" },
            "legacy_error": legacy_error,
        }),
    );

    if advanced_result.is_ok() || legacy_result.is_ok() {
        Ok(())
    } else {
        Err("macOS voice processing ducking could not be disabled.".to_string())
    }
}

#[cfg(target_os = "macos")]
struct MacosVoiceProcessingCapture {
    unit: coreaudio::audio_unit::AudioUnit,
}

#[cfg(target_os = "macos")]
impl Drop for MacosVoiceProcessingCapture {
    fn drop(&mut self) {
        MACOS_VOICE_PROCESSING_ACTIVE.store(false, Ordering::Release);
        macos_voice_playback_clear();
        // AudioUnit's own Drop uninitializes and disposes; stopping first
        // keeps CoreAudio from rendering into a half-torn-down unit.
        let _ = self.unit.stop();
    }
}

#[cfg(target_os = "macos")]
fn macos_voice_processing_core_device(
    device_id: &str,
    label: &str,
) -> Result<coreaudio::sys::AudioDeviceID, String> {
    use coreaudio::audio_unit::macos_helpers::{get_default_device_id, get_device_id_from_name};

    if device_id.is_empty() || device_id == "default" {
        return get_default_device_id(true).ok_or_else(|| {
            "No default input device is available for voice processing.".to_string()
        });
    }
    get_device_id_from_name(label, true).ok_or_else(|| {
        format!("Input device {label} was not found for voice processing capture.")
    })
}

/// Builds a mic capture stream through macOS's VoiceProcessingIO audio unit,
/// which applies the system echo canceller (plus noise suppression and AGC)
/// before we ever see the samples. The same unit/config Safari and Chrome
/// use for getUserMedia echo cancellation.
#[cfg(target_os = "macos")]
fn build_macos_voice_processing_capture(
    app: AppHandle,
    device_id: String,
    label: &str,
) -> Result<(MacosVoiceProcessingCapture, Arc<StdMutex<NativeAudioShared>>, u32), String> {
    use coreaudio::audio_unit::audio_format::LinearPcmFlags;
    use coreaudio::audio_unit::render_callback::{self, data};
    use coreaudio::audio_unit::{AudioUnit, Element, IOType, SampleFormat, Scope, StreamFormat};
    use coreaudio::sys::{
        kAudioOutputUnitProperty_CurrentDevice, kAudioOutputUnitProperty_EnableIO,
        kAudioUnitProperty_StreamFormat,
    };

    let describe = |stage: &str, error: coreaudio::Error| {
        format!("Voice processing capture failed at {stage}: {error}")
    };

    let core_device = macos_voice_processing_core_device(&device_id, label)?;
    let mut unit = AudioUnit::new(IOType::VoiceProcessingIO)
        .map_err(|error| describe("create", error))?;
    // EnableIO and formats only apply to an uninitialized unit.
    unit.uninitialize().map_err(|error| describe("uninitialize", error))?;
    configure_macos_voice_processing_no_ducking(&mut unit)?;
    let enable: u32 = 1;
    unit.set_property(
        kAudioOutputUnitProperty_EnableIO,
        Scope::Input,
        Element::Input,
        Some(&enable),
    )
    .map_err(|error| describe("enable input", error))?;
    // The output element stays enabled and renders the voice agent's TTS
    // (silence otherwise): voice processing treats exactly what this unit
    // renders as the echo far-end, so agent speech mathematically cannot
    // come back as mic input.
    unit.set_property(
        kAudioOutputUnitProperty_EnableIO,
        Scope::Output,
        Element::Output,
        Some(&enable),
    )
    .map_err(|error| describe("enable output", error))?;
    unit.set_property(
        kAudioOutputUnitProperty_CurrentDevice,
        Scope::Global,
        Element::Input,
        Some(&core_device),
    )
    .map_err(|error| describe("select input device", error))?;
    if let Some(output_device) =
        coreaudio::audio_unit::macos_helpers::get_default_device_id(false)
    {
        let _ = unit.set_property(
            kAudioOutputUnitProperty_CurrentDevice,
            Scope::Global,
            Element::Output,
            Some(&output_device),
        );
    }
    let stream_format = StreamFormat {
        sample_rate: f64::from(MACOS_VOICE_PROCESSING_SAMPLE_RATE),
        sample_format: SampleFormat::F32,
        flags: LinearPcmFlags::IS_FLOAT | LinearPcmFlags::IS_PACKED,
        channels: 1,
    };
    unit.set_property(
        kAudioUnitProperty_StreamFormat,
        Scope::Output,
        Element::Input,
        Some(&stream_format.to_asbd()),
    )
    .map_err(|error| describe("set capture format", error))?;
    unit.set_property(
        kAudioUnitProperty_StreamFormat,
        Scope::Input,
        Element::Output,
        Some(&stream_format.to_asbd()),
    )
    .map_err(|error| describe("set render format", error))?;

    let shared = Arc::new(StdMutex::new(NativeAudioShared::new(
        MACOS_VOICE_PROCESSING_SAMPLE_RATE,
    )));
    let callback_shared = shared.clone();
    let callback_device_id = device_id;
    type VoiceProcessingArgs = render_callback::Args<data::Interleaved<f32>>;
    unit.set_input_callback(move |args: VoiceProcessingArgs| {
        process_native_audio_samples(
            &app,
            &callback_device_id,
            &callback_shared,
            args.data.buffer.to_vec(),
        );
        Ok(())
    })
    .map_err(|error| describe("install callback", error))?;
    let render_queue = Arc::clone(macos_voice_playback_queue());
    type VoiceRenderArgs = render_callback::Args<data::Interleaved<f32>>;
    unit.set_render_callback(move |args: VoiceRenderArgs| {
        let VoiceRenderArgs { data, .. } = args;
        let mut queue = render_queue.lock().ok();
        for sample in data.buffer.iter_mut() {
            *sample = queue
                .as_mut()
                .and_then(|queue| queue.pop_front())
                .unwrap_or(0.0);
        }
        Ok(())
    })
    .map_err(|error| describe("install render callback", error))?;
    unit.initialize().map_err(|error| describe("initialize", error))?;
    unit.start().map_err(|error| describe("start", error))?;
    MACOS_VOICE_PROCESSING_ACTIVE.store(true, Ordering::Release);

    Ok((
        MacosVoiceProcessingCapture { unit },
        shared,
        MACOS_VOICE_PROCESSING_SAMPLE_RATE,
    ))
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
    replay_buffered: bool,
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

        if replay_buffered {
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

    // macOS: capture through the system voice-processing unit so the OS
    // echo canceller strips played-back agent speech from the mic signal.
    // Any failure (virtual devices, odd aggregates) falls back to cpal.
    #[cfg(target_os = "macos")]
    match build_macos_voice_processing_capture(app.clone(), device_id.clone(), &label) {
        Ok((capture, shared, sample_rate)) => {
            let mut owners = HashSet::new();
            owners.insert(owner.clone());
            let next_session = NativeAudioSession {
                device_id,
                label,
                owners,
                sample_rate,
                shared,
                _stream: NativeAudioStreamHandle::VoiceProcessing(capture),
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
                    "engine": "voice_processing_io",
                    "owner_count": status.owner_count,
                }),
            );
            return Ok(status);
        }
        Err(error) => {
            log_whisper_local_audio_event(
                "audio.monitor.start.voice_processing_fallback",
                None,
                json!({
                    "owner": owner,
                    "device_id": &device_id,
                    "error": error,
                }),
            );
        }
    }

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
        _stream: NativeAudioStreamHandle::Cpal(stream),
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

fn deepgram_realtime_url(language: &str, sample_rate: u32, keyterms: &[String]) -> String {
    let mut url = format!(
        "{DEEPGRAM_LISTEN_WS_URL}?model={DEEPGRAM_MODEL}&language={language}&encoding=linear16&sample_rate={sample_rate}&channels=1&interim_results=true&smart_format=true"
    );

    for keyterm in keyterms {
        url.push_str("&keyterm=");
        url.push_str(&percent_encode_query_component(keyterm));
    }

    url
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
    let bias_prompt = voice_dictionary_whisper_prompt(app);
    let mut args = vec![
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
    if let Some(prompt) = bias_prompt.as_ref() {
        args.push("--prompt".to_string());
        args.push(prompt.clone());
    }
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
    #[cfg(target_os = "macos")]
    {
        register_audio_widget_space_change_observer(app);
        register_audio_widget_bar_hover_mouse_monitors(app);
    }

    if let Some(window) = app.get_webview_window(AUDIO_WIDGET_WINDOW_LABEL) {
        let visible = window.is_visible().ok();
        log_audio_diagnostic_event(
            "audio.widget.ensure.existing",
            json!({
                "label": AUDIO_WIDGET_WINDOW_LABEL,
                "visible": visible,
            }),
        );
        #[cfg(target_os = "macos")]
        audio_widget_apply_macos_space_style(&window);
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
    .skip_taskbar(true)
    .visible_on_all_workspaces(true)
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

    #[cfg(target_os = "macos")]
    audio_widget_apply_macos_space_style(&window);

    let app_handle = app.clone();
    let window_for_events = window.clone();
    window.on_window_event(move |event| {
        match event {
            WindowEvent::CloseRequested { api, .. } => {
                if APP_CLOSE_SHUTDOWN_IN_FLIGHT.load(Ordering::SeqCst)
                    || APP_SHUTDOWN_PHASE.load(Ordering::SeqCst) != APP_SHUTDOWN_PHASE_RUNNING
                {
                    #[cfg(target_os = "macos")]
                    snipping_restore_window_class_for_close_now(&window_for_events);
                    return;
                }
                api.prevent_close();
                if let Some(window) = app_handle.get_webview_window(AUDIO_WIDGET_WINDOW_LABEL) {
                    let _ = window.hide();
                }
                emit_audio_widget_current_visibility(&app_handle, false);
            }
            WindowEvent::Destroyed => {
                log_audio_diagnostic_event(
                    "audio.widget.window.destroyed",
                    json!({
                        "label": AUDIO_WIDGET_WINDOW_LABEL,
                    }),
                );
                emit_audio_widget_current_visibility(&app_handle, false);
            }
            _ => {}
        }
    });

    Ok(window)
}

/// Cross-Space style for the always-available audio widget. Tauri's
/// `visible_on_all_workspaces` only covers ordinary Spaces on macOS; widgets
/// shown while another app owns a fullscreen Space also need AppKit's
/// FullScreenAuxiliary behavior and a level above the fullscreen window.
/// Re-asserted on ensure/show because these are mutable NSWindow properties.
#[cfg(target_os = "macos")]
fn audio_widget_apply_macos_space_style(window: &tauri::WebviewWindow) {
    snipping_convert_overlay_window_to_panel(window);
    let window_for_main = window.clone();
    let _ = window.run_on_main_thread(move || {
        snipping_catch_objc("audio_widget_apply_macos_space_style", || {
            let Ok(ns_window) = window_for_main.ns_window() else {
                return;
            };
            if ns_window.is_null() {
                return;
            }
            let ns_window: &NSWindow = unsafe { &*ns_window.cast::<NSWindow>() };
            ns_window.setCollectionBehavior(
                objc2_app_kit::NSWindowCollectionBehavior::CanJoinAllSpaces
                    | objc2_app_kit::NSWindowCollectionBehavior::CanJoinAllApplications
                    | objc2_app_kit::NSWindowCollectionBehavior::FullScreenAuxiliary
                    | objc2_app_kit::NSWindowCollectionBehavior::Stationary
                    | objc2_app_kit::NSWindowCollectionBehavior::IgnoresCycle,
            );
            ns_window.setLevel(objc2_app_kit::NSScreenSaverWindowLevel);
            ns_window.setAcceptsMouseMovedEvents(true);
        });
    });
}

/// Surfaces the widget even while Diff Forge is not active, such as when a
/// push-to-talk action opens it inside another app's fullscreen Space.
#[cfg(target_os = "macos")]
fn audio_widget_order_front_regardless(window: &tauri::WebviewWindow) {
    let window_for_main = window.clone();
    let _ = window.run_on_main_thread(move || {
        snipping_catch_objc("audio_widget_order_front_regardless", || {
            let Ok(ns_window) = window_for_main.ns_window() else {
                return;
            };
            if ns_window.is_null() {
                return;
            }
            let ns_window: &NSWindow = unsafe { &*ns_window.cast::<NSWindow>() };
            ns_window.orderFrontRegardless();
        });
    });
}

#[cfg(target_os = "macos")]
fn audio_widget_resign_key_window_if_needed(
    window: &tauri::WebviewWindow,
    context: &'static str,
) -> bool {
    let mut released = false;
    snipping_catch_objc(context, || {
        let Ok(ns_window) = window.ns_window() else {
            return;
        };
        if ns_window.is_null() {
            return;
        }
        let ns_window: &NSWindow = unsafe { &*ns_window.cast::<NSWindow>() };
        if ns_window.isKeyWindow() {
            ns_window.resignKeyWindow();
            released = true;
        }
    });
    released
}

#[cfg(target_os = "macos")]
const AUDIO_WIDGET_REASSERT_SHOW_MS: u64 = 120;
#[cfg(target_os = "macos")]
const AUDIO_WIDGET_COLD_BOOT_REASSERT_MS: u64 = 300;

#[cfg(target_os = "macos")]
static AUDIO_WIDGET_MACOS_SPACE_OBSERVER_STARTED: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "macos")]
static AUDIO_WIDGET_BAR_HOVER_MONITORS_STARTED: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "macos")]
static AUDIO_WIDGET_BAR_HOVER_ACTIVE: AtomicBool = AtomicBool::new(false);

#[cfg(target_os = "macos")]
fn register_audio_widget_space_change_observer(app: &AppHandle) {
    if AUDIO_WIDGET_MACOS_SPACE_OBSERVER_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }

    let app_handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        snipping_catch_objc("register_audio_widget_space_change_observer", || {
            let workspace = objc2_app_kit::NSWorkspace::sharedWorkspace();
            let center = workspace.notificationCenter();
            let block = block2::RcBlock::new(
                move |_notification: std::ptr::NonNull<objc2_foundation::NSNotification>| {
                    snipping_catch_objc("audio_widget_space_change_observer_callback", || {
                        let _ = app_handle.emit(
                            AUDIO_WIDGET_SPACE_CHANGED_EVENT,
                            json!({ "source": "macos_space" }),
                        );
                    });
                },
            );
            let token = unsafe {
                center.addObserverForName_object_queue_usingBlock(
                    Some(objc2_app_kit::NSWorkspaceActiveSpaceDidChangeNotification),
                    None,
                    None,
                    &block,
                )
            };
            // The observer lives for the app's lifetime.
            std::mem::forget(token);
        });
    });
}

#[cfg(target_os = "macos")]
fn audio_widget_emit_bar_hover_changed(app: &AppHandle, hovering: bool) {
    let previous = AUDIO_WIDGET_BAR_HOVER_ACTIVE.swap(hovering, Ordering::AcqRel);
    if previous == hovering {
        return;
    }

    let _ = app.emit(
        AUDIO_WIDGET_BAR_HOVER_CHANGED_EVENT,
        json!({ "hovering": hovering }),
    );
}

const AUDIO_WIDGET_BAR_ACTIVE_WIDTH: f64 = 124.0;
const AUDIO_WIDGET_BAR_ACTIVE_HEIGHT: f64 = 44.0;
const AUDIO_WIDGET_BAR_NOTICE_WIDTH: f64 = 392.0;
const AUDIO_WIDGET_BAR_NOTICE_HEIGHT: f64 = 52.0;
const AUDIO_WIDGET_BAR_IDLE_WIDTH: f64 = 200.0;
const AUDIO_WIDGET_BAR_IDLE_HEIGHT: f64 = 96.0;
const AUDIO_WIDGET_BAR_FRAME_TOLERANCE: f64 = 8.0;

fn audio_widget_bar_frame_matches_size(
    width: f64,
    height: f64,
    target_width: f64,
    target_height: f64,
) -> bool {
    (width - target_width).abs() <= AUDIO_WIDGET_BAR_FRAME_TOLERANCE
        && (height - target_height).abs() <= AUDIO_WIDGET_BAR_FRAME_TOLERANCE
}

fn audio_widget_bar_frame_is_idle_size(width: f64, height: f64) -> bool {
    audio_widget_bar_frame_matches_size(
        width,
        height,
        AUDIO_WIDGET_BAR_IDLE_WIDTH,
        AUDIO_WIDGET_BAR_IDLE_HEIGHT,
    )
}

fn audio_widget_bar_frame_is_whole_hover_size(width: f64, height: f64) -> bool {
    audio_widget_bar_frame_matches_size(
        width,
        height,
        AUDIO_WIDGET_BAR_ACTIVE_WIDTH,
        AUDIO_WIDGET_BAR_ACTIVE_HEIGHT,
    ) || audio_widget_bar_frame_matches_size(
        width,
        height,
        AUDIO_WIDGET_BAR_NOTICE_WIDTH,
        AUDIO_WIDGET_BAR_NOTICE_HEIGHT,
    )
}

fn audio_widget_bar_hover_from_top_left(
    width: f64,
    height: f64,
    local_x: f64,
    local_y: f64,
    active: bool,
) -> bool {
    if local_x < 0.0 || local_y < 0.0 || local_x > width || local_y > height {
        return false;
    }

    if audio_widget_bar_frame_is_idle_size(width, height) {
        if active {
            return local_y >= AUDIO_WIDGET_BAR_IDLE_ACTIVE_HIT_TOP;
        }

        return local_y >= (height - AUDIO_WIDGET_BAR_IDLE_ACTIVATE_HIT_HEIGHT).max(0.0);
    }

    audio_widget_bar_frame_is_whole_hover_size(width, height)
}

#[cfg(target_os = "macos")]
fn audio_widget_bar_hover_from_bottom_left(
    width: f64,
    height: f64,
    local_x: f64,
    local_from_bottom: f64,
    active: bool,
) -> bool {
    if local_x < 0.0
        || local_from_bottom < 0.0
        || local_x > width
        || local_from_bottom > height
    {
        return false;
    }

    if audio_widget_bar_frame_is_idle_size(width, height) {
        if active {
            return local_from_bottom <= (height - AUDIO_WIDGET_BAR_IDLE_ACTIVE_HIT_TOP).max(0.0);
        }

        return local_from_bottom <= AUDIO_WIDGET_BAR_IDLE_ACTIVATE_HIT_HEIGHT;
    }

    audio_widget_bar_frame_is_whole_hover_size(width, height)
}

#[cfg(target_os = "macos")]
fn audio_widget_apply_bar_hover_focus_to_ns_window(ns_window: &NSWindow, hovering: bool) {
    if hovering {
        if !ns_window.isKeyWindow() {
            ns_window.makeKeyAndOrderFront(None);
        }
    } else if ns_window.isKeyWindow() {
        ns_window.resignKeyWindow();
    }
}

#[cfg(target_os = "macos")]
fn audio_widget_apply_bar_hover_focus(app: &AppHandle, hovering: bool) {
    let Some(window) = app.get_webview_window(AUDIO_WIDGET_WINDOW_LABEL) else {
        return;
    };
    let window_for_main = window.clone();
    let _ = window.run_on_main_thread(move || {
        snipping_catch_objc("audio_widget_apply_bar_hover_focus", || {
            let Ok(ns_ptr) = window_for_main.ns_window() else {
                return;
            };
            if ns_ptr.is_null() {
                return;
            }

            let ns_window: &NSWindow = unsafe { &*ns_ptr.cast::<NSWindow>() };
            if !ns_window.isVisible() {
                return;
            }

            audio_widget_apply_bar_hover_focus_to_ns_window(ns_window, hovering);
        });
    });
}

/// AppKit only sends mouseMoved to the key window. When another app is focused,
/// the non-activating audio panel needs a native monitor to notice hover first;
/// once the cursor is over a hoverable bar frame, it can take key status
/// without activating Diff Forge or switching Spaces.
#[cfg(target_os = "macos")]
fn audio_widget_bar_handle_mouse_moved(app: &AppHandle) {
    snipping_catch_objc("audio_widget_bar_handle_mouse_moved", || {
        let Some(window) = app.get_webview_window(AUDIO_WIDGET_WINDOW_LABEL) else {
            audio_widget_emit_bar_hover_changed(app, false);
            return;
        };
        if !window.is_visible().unwrap_or(false) {
            audio_widget_emit_bar_hover_changed(app, false);
            return;
        }

        let Ok(ns_ptr) = window.ns_window() else {
            audio_widget_emit_bar_hover_changed(app, false);
            return;
        };
        if ns_ptr.is_null() {
            audio_widget_emit_bar_hover_changed(app, false);
            return;
        }

        let ns_window: &NSWindow = unsafe { &*ns_ptr.cast::<NSWindow>() };
        if !ns_window.isVisible() {
            audio_widget_emit_bar_hover_changed(app, false);
            return;
        }

        let frame = ns_window.frame();
        let location = objc2_app_kit::NSEvent::mouseLocation();
        let active = AUDIO_WIDGET_BAR_HOVER_ACTIVE.load(Ordering::Acquire);
        let local_x = location.x - frame.origin.x;
        let local_from_bottom = location.y - frame.origin.y;
        let hovering = audio_widget_bar_hover_from_bottom_left(
            frame.size.width,
            frame.size.height,
            local_x,
            local_from_bottom,
            active,
        );

        audio_widget_apply_bar_hover_focus_to_ns_window(ns_window, hovering);
        audio_widget_emit_bar_hover_changed(app, hovering);
    });
}

#[cfg(target_os = "macos")]
fn register_audio_widget_bar_hover_mouse_monitors(app: &AppHandle) {
    if AUDIO_WIDGET_BAR_HOVER_MONITORS_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }

    let global_app = app.clone();
    let local_app = app.clone();
    let _ = app.run_on_main_thread(move || {
        snipping_catch_objc("register_audio_widget_bar_hover_mouse_monitors", || {
            use objc2_app_kit::{NSEvent, NSEventMask};

            let mask = NSEventMask::MouseMoved;

            let global_block =
                block2::RcBlock::new(move |_event: std::ptr::NonNull<objc2_app_kit::NSEvent>| {
                    audio_widget_bar_handle_mouse_moved(&global_app);
                });
            if let Some(token) =
                NSEvent::addGlobalMonitorForEventsMatchingMask_handler(mask, &global_block)
            {
                std::mem::forget(token);
            }

            let local_block = block2::RcBlock::new(
                move |event: std::ptr::NonNull<objc2_app_kit::NSEvent>| -> *mut objc2_app_kit::NSEvent {
                    audio_widget_bar_handle_mouse_moved(&local_app);
                    event.as_ptr()
                },
            );
            let local_token =
                unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &local_block) };
            if let Some(token) = local_token {
                std::mem::forget(token);
            }
        });
    });
}

#[cfg(target_os = "macos")]
fn audio_widget_reassert_open_state(app: &AppHandle, _make_key: bool) -> bool {
    let Some(window) = app.get_webview_window(AUDIO_WIDGET_WINDOW_LABEL) else {
        return false;
    };
    if !window.is_visible().unwrap_or(false) {
        return false;
    }
    audio_widget_apply_macos_space_style(&window);
    audio_widget_order_front_regardless(&window);
    true
}

#[cfg(target_os = "macos")]
fn audio_widget_emit_open_reassert(app: &AppHandle, make_key: bool) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        sleep(Duration::from_millis(AUDIO_WIDGET_REASSERT_SHOW_MS)).await;
        if !audio_widget_reassert_open_state(&app, make_key) {
            return;
        }
        sleep(Duration::from_millis(
            AUDIO_WIDGET_COLD_BOOT_REASSERT_MS.saturating_sub(AUDIO_WIDGET_REASSERT_SHOW_MS),
        ))
        .await;
        let _ = audio_widget_reassert_open_state(&app, make_key);
    });
}

#[cfg(not(target_os = "macos"))]
fn audio_widget_emit_open_reassert(_app: &AppHandle, _make_key: bool) {}

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

#[cfg(target_os = "macos")]
fn audio_widget_release_keyboard_focus_on_main_thread(app: &AppHandle) -> Result<bool, String> {
    log_audio_diagnostic_event("audio.widget.release_keyboard_focus.request", json!({}));

    run_audio_widget_action_on_main_thread(app, "release_keyboard_focus", |app| {
        let Some(window) = app.get_webview_window(AUDIO_WIDGET_WINDOW_LABEL) else {
            return Ok(false);
        };

        let released = audio_widget_resign_key_window_if_needed(
            &window,
            "audio_widget_release_keyboard_focus",
        );

        log_audio_diagnostic_event(
            "audio.widget.release_keyboard_focus.result",
            json!({ "released": released }),
        );
        Ok(released)
    })
}

#[cfg(not(target_os = "macos"))]
fn audio_widget_release_keyboard_focus_on_main_thread(_app: &AppHandle) -> Result<bool, String> {
    Ok(false)
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
        #[cfg(target_os = "macos")]
        audio_widget_apply_macos_space_style(&window);
        window
            .show()
            .map_err(|error| format!("Unable to show audio widget: {error}"))?;
        #[cfg(target_os = "macos")]
        audio_widget_order_front_regardless(&window);
        #[cfg(target_os = "macos")]
        let released_keyboard = audio_widget_resign_key_window_if_needed(
            &window,
            "audio_widget_show_release_keyboard_focus",
        );
        #[cfg(target_os = "macos")]
        if released_keyboard {
            log_audio_diagnostic_event(
                "audio.widget.show_window.keyboard_focus_released",
                json!({}),
            );
        }

        if focus {
            #[cfg(target_os = "macos")]
            log_audio_diagnostic_event(
                "audio.widget.show_window.focus_skipped_macos",
                json!({ "reason": "audio_widget_must_not_steal_keyboard" }),
            );
            #[cfg(not(target_os = "macos"))]
            let _ = window.set_focus();
        }
        audio_widget_emit_open_reassert(app, focus);

        Ok(())
    })
}

fn hide_audio_widget_window_on_main_thread(app: &AppHandle) -> Result<(), String> {
    log_audio_diagnostic_event("audio.widget.hide_window.request", json!({}));

    run_audio_widget_action_on_main_thread(app, "hide", |app| {
        if let Some(window) = app.get_webview_window(AUDIO_WIDGET_WINDOW_LABEL) {
            #[cfg(target_os = "macos")]
            {
                let _ = audio_widget_resign_key_window_if_needed(
                    &window,
                    "audio_widget_hide_release_keyboard_focus",
                );
            }
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

const AUDIO_WIDGET_BAR_IDLE_ACTIVATE_HIT_HEIGHT: f64 = 34.0;
const AUDIO_WIDGET_BAR_IDLE_ACTIVE_HIT_TOP: f64 = 14.0;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct AudioWidgetBarHoverSnapshotRequest {
    active: bool,
    focus: bool,
}

impl Default for AudioWidgetBarHoverSnapshotRequest {
    fn default() -> Self {
        Self {
            active: false,
            focus: false,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioWidgetBarHoverSnapshot {
    hovering: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioWidgetBarAnchorStrategy {
    use_full_monitor_bounds: bool,
}

#[cfg(target_os = "macos")]
fn audio_widget_cf_dictionary_value(
    dictionary: &objc2_core_foundation::CFDictionary,
    key: &str,
) -> Option<*const std::ffi::c_void> {
    let cf_key = objc2_core_foundation::CFString::from_str(key);
    let cf_key_ref = cf_key.as_ref() as *const objc2_core_foundation::CFString;
    let value = unsafe { dictionary.value(cf_key_ref.cast()) };
    (!value.is_null()).then_some(value)
}

#[cfg(target_os = "macos")]
fn audio_widget_cf_number_i32(
    dictionary: &objc2_core_foundation::CFDictionary,
    key: &str,
) -> Option<i32> {
    let value = audio_widget_cf_dictionary_value(dictionary, key)?
        as *const objc2_core_foundation::CFNumber;
    let mut output: i32 = 0;
    let ok = unsafe {
        (*value).value(
            objc2_core_foundation::CFNumberType::IntType,
            (&mut output as *mut i32).cast(),
        )
    };
    ok.then_some(output)
}

#[cfg(target_os = "macos")]
fn audio_widget_window_bounds(
    dictionary: &objc2_core_foundation::CFDictionary,
) -> Option<objc2_core_foundation::CGRect> {
    let bounds = audio_widget_cf_dictionary_value(dictionary, "kCGWindowBounds")?
        as *const objc2_core_foundation::CFDictionary;
    let mut rect = objc2_core_foundation::CGRect::default();
    let ok = unsafe {
        objc2_core_graphics::CGRectMakeWithDictionaryRepresentation(Some(&*bounds), &mut rect)
    };
    ok.then_some(rect)
}

#[cfg(target_os = "macos")]
fn audio_widget_frontmost_app_has_fullscreen_window(frontmost_pid: i32) -> bool {
    if frontmost_pid <= 0 {
        return false;
    }

    let Some(windows) = objc2_core_graphics::CGWindowListCopyWindowInfo(
        objc2_core_graphics::CGWindowListOption::OptionOnScreenOnly
            | objc2_core_graphics::CGWindowListOption::ExcludeDesktopElements,
        0,
    ) else {
        return false;
    };

    let Some(main_thread_marker) = objc2::MainThreadMarker::new() else {
        return false;
    };
    let screens = objc2_app_kit::NSScreen::screens(main_thread_marker);
    let screen_count = screens.count();
    if screen_count == 0 {
        return false;
    }

    for window_index in 0..windows.count() {
        let window_ref =
            unsafe { windows.value_at_index(window_index) } as *const objc2_core_foundation::CFDictionary;
        if window_ref.is_null() {
            continue;
        }
        let window_info = unsafe { &*window_ref };
        if audio_widget_cf_number_i32(window_info, "kCGWindowOwnerPID") != Some(frontmost_pid) {
            continue;
        }

        let Some(bounds) = audio_widget_window_bounds(window_info) else {
            continue;
        };
        if bounds.size.width <= 0.0 || bounds.size.height <= 0.0 {
            continue;
        }

        for screen_index in 0..screen_count {
            let screen = screens.objectAtIndex(screen_index);
            let frame = screen.frame();
            let width_matches = (bounds.size.width - frame.size.width).abs() <= 4.0;
            let height_matches = (bounds.size.height - frame.size.height).abs() <= 4.0;
            if width_matches && height_matches {
                return true;
            }
        }
    }

    false
}

#[cfg(target_os = "macos")]
fn audio_widget_bar_anchor_strategy_on_main_thread() -> AudioWidgetBarAnchorStrategy {
    let mut use_full_monitor_bounds = false;
    snipping_catch_objc("audio_widget_bar_anchor_strategy", || {
        let workspace = objc2_app_kit::NSWorkspace::sharedWorkspace();
        let current_app = objc2_app_kit::NSRunningApplication::currentApplication();
        let Some(frontmost_app) = workspace.frontmostApplication() else {
            return;
        };
        let current_pid = current_app.processIdentifier();
        let frontmost_pid = frontmost_app.processIdentifier();
        if current_pid <= 0 || frontmost_pid <= 0 {
            return;
        }

        // In another app's fullscreen Space, macOS still reports the normal
        // desktop work area for this auxiliary window. Anchor against the full
        // display only when the frontmost app actually owns a screen-sized
        // window; a normal desktop Space with another app frontmost should still
        // use the Dock-safe work area.
        use_full_monitor_bounds = current_pid != frontmost_pid
            && audio_widget_frontmost_app_has_fullscreen_window(frontmost_pid);
    });

    AudioWidgetBarAnchorStrategy {
        use_full_monitor_bounds,
    }
}

#[cfg(target_os = "macos")]
fn audio_widget_bar_anchor_strategy_for(
    app: &AppHandle,
) -> Result<AudioWidgetBarAnchorStrategy, String> {
    run_audio_widget_action_on_main_thread(app, "bar_anchor_strategy", |_app| {
        Ok(audio_widget_bar_anchor_strategy_on_main_thread())
    })
}

#[cfg(not(target_os = "macos"))]
fn audio_widget_bar_anchor_strategy_for(
    _app: &AppHandle,
) -> Result<AudioWidgetBarAnchorStrategy, String> {
    Ok(AudioWidgetBarAnchorStrategy {
        use_full_monitor_bounds: false,
    })
}

fn audio_widget_bar_hover_snapshot_for(
    app: &AppHandle,
    request: &AudioWidgetBarHoverSnapshotRequest,
) -> AudioWidgetBarHoverSnapshot {
    let hovering = app
        .get_webview_window(AUDIO_WIDGET_WINDOW_LABEL)
        .filter(|window| window.is_visible().unwrap_or(false))
        .and_then(|window| {
            let cursor = app.cursor_position().ok()?;
            let position = window.outer_position().ok()?;
            let size = window.outer_size().ok()?;
            let scale = window.scale_factor().unwrap_or(1.0).max(0.1);
            let local_x = (cursor.x - f64::from(position.x)) / scale;
            let local_y = (cursor.y - f64::from(position.y)) / scale;
            let width = f64::from(size.width.max(1));
            let height = f64::from(size.height.max(1));
            let logical_width = width / scale;
            let logical_height = height / scale;

            Some(audio_widget_bar_hover_from_top_left(
                logical_width,
                logical_height,
                local_x,
                local_y,
                request.active,
            ))
        })
        .unwrap_or(false);

    #[cfg(target_os = "macos")]
    if request.focus {
        audio_widget_apply_bar_hover_focus(app, hovering);
        audio_widget_emit_bar_hover_changed(app, hovering);
    }

    AudioWidgetBarHoverSnapshot { hovering }
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

    #[cfg(target_os = "macos")]
    let focus_widget = false;
    #[cfg(not(target_os = "macos"))]
    let focus_widget = true;

    if let Err(error) = show_audio_widget_window_on_main_thread(app, focus_widget) {
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
    match timeout(
        Duration::from_secs(AUDIO_INPUT_DEVICE_LIST_TIMEOUT_SECS),
        tokio::task::spawn_blocking(|| audio_input_devices_for_host(&cpal_host())),
    )
    .await
    {
        Ok(Ok(result)) => result,
        Ok(Err(error)) => Err(format!("Unable to list audio input sources: {error}")),
        Err(_) => Err(
            "Audio input source check timed out. The OS audio device service did not respond."
                .to_string(),
        ),
    }
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

fn normalize_cloud_voice_agent_submission_mode(value: Option<String>) -> String {
    match clean_cloud_voice_agent_text(value, 32)
        .to_ascii_lowercase()
        .replace(['-', ' '], "_")
        .as_str()
    {
        "manual" | "manual_submit" | "push_to_submit" => "manual".to_string(),
        _ => "auto".to_string(),
    }
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
    cloud_mcp_apply_ws_auth_headers(
        &mut request,
        auth_bearer,
        ws_target.route_token.as_deref(),
    )?;
    Ok(request)
}

/// On macOS with a live voice-processing capture, TTS audio plays through
/// the capture unit's own output element (perfect echo-cancellation
/// reference) instead of the webview. The payload is tagged so the webview
/// player skips scheduling those frames.
fn cloud_voice_agent_route_tts_playback(payload: Value) -> Value {
    #[cfg(target_os = "macos")]
    {
        let mut payload = payload;
        match cloud_voice_agent_event_kind(&payload) {
            "voice_agent_tts_audio" => {
                if MACOS_VOICE_PROCESSING_ACTIVE.load(Ordering::Acquire) {
                    let sample_rate = payload
                        .pointer("/audio/sample_rate")
                        .or_else(|| payload.pointer("/audio/sampleRate"))
                        .and_then(Value::as_u64)
                        .unwrap_or(24_000) as u32;
                    let decoded = payload
                        .pointer("/audio/base64")
                        .and_then(Value::as_str)
                        .and_then(|base64_text| {
                            general_purpose::STANDARD.decode(base64_text).ok()
                        });
                    if let Some(bytes) = decoded {
                        macos_voice_playback_enqueue_linear16(&bytes, sample_rate);
                        if let Some(audio) = payload.get_mut("audio") {
                            audio["native_playback"] = json!(true);
                        }
                        payload["native_playback"] = json!(true);
                    }
                }
            }
            "voice_agent_tts_error" | "voice_agent_error" => {
                macos_voice_playback_clear();
            }
            _ => {}
        }
        return payload;
    }
    #[cfg(not(target_os = "macos"))]
    payload
}

fn emit_cloud_voice_agent_event(app: &AppHandle, payload: Value) {
    let payload = cloud_voice_agent_route_tts_playback(payload);
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
        "allowed_tools": ["create_plan", "open_coding_agents", "dispatch_remote_tasks", "device_control", "highlight_terminal"],
        "tool_choice": "auto",
        "response_contract": {
            "immediate_feedback_required": true,
            "main_response_required": true,
            "main_response_may_call_tool": true,
            "regular_response_kind": "voice_agent_llm_feedback",
            "plan_tool_name": "create_plan",
            "agent_open_tool_name": "open_coding_agents",
            "terminal_highlight_tool_name": "highlight_terminal",
            "remote_dispatch_tool_name": "dispatch_remote_tasks",
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
    let agents_dir = coordination::db::coordination_workspace_state_root(&root);
    fs::create_dir_all(&agents_dir)
        .map_err(|error| format!("Unable to create workspace state directory: {error}"))?;
    if coordination::db::coordination_state_root_is_visible(&root, &agents_dir) {
        let _ = ensure_workspace_agents_gitignore(&root);
    }
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
        || error.contains("sending after closing")
        || error.contains("websocket protocol error: connection reset")
}

fn cloud_voice_agent_event_kind(payload: &Value) -> &str {
    payload
        .get("kind")
        .or_else(|| payload.get("event_kind"))
        .or_else(|| payload.get("eventKind"))
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

fn cloud_voice_agent_waits_for_binary_audio(payload: &Value) -> bool {
    cloud_voice_agent_event_kind(payload) == "voice_agent_tts_audio"
        && (payload
            .get("binary_audio_follows")
            .and_then(Value::as_bool)
            .unwrap_or(false)
            || payload
                .pointer("/audio/binary")
                .and_then(Value::as_bool)
                .unwrap_or(false))
}

fn cloud_voice_agent_payload_with_binary_audio(mut payload: Value, bytes: &[u8]) -> Value {
    if let Some(object) = payload.as_object_mut() {
        let audio = object.entry("audio").or_insert_with(|| json!({}));
        if !audio.is_object() {
            *audio = json!({});
        }
        if let Some(audio_object) = audio.as_object_mut() {
            audio_object.insert(
                "base64".to_string(),
                Value::String(general_purpose::STANDARD.encode(bytes)),
            );
            audio_object.insert("binary".to_string(), Value::Bool(false));
            audio_object.insert("byte_length".to_string(), json!(bytes.len()));
        }
        object.insert("binary_audio_follows".to_string(), Value::Bool(false));
    }
    payload
}

fn cloud_voice_agent_emit_payload_frame(
    app: &AppHandle,
    payload: Value,
    pending_binary_audio: &mut Option<Value>,
    tts_suppression_until: &mut Option<Instant>,
) -> bool {
    if cloud_voice_agent_waits_for_binary_audio(&payload) {
        update_cloud_voice_agent_tts_suppression(&payload, tts_suppression_until);
        *pending_binary_audio = Some(payload);
        return false;
    }

    let request_complete = cloud_voice_agent_event_completes_request(&payload);
    update_cloud_voice_agent_tts_suppression(&payload, tts_suppression_until);
    emit_cloud_voice_agent_event(app, payload);
    request_complete
}

fn cloud_voice_agent_emit_binary_frame(
    app: &AppHandle,
    bytes: &[u8],
    pending_binary_audio: &mut Option<Value>,
    tts_suppression_until: &mut Option<Instant>,
) -> bool {
    if let Some(payload) = pending_binary_audio.take() {
        let payload = cloud_voice_agent_payload_with_binary_audio(payload, bytes);
        return cloud_voice_agent_emit_payload_frame(
            app,
            payload,
            pending_binary_audio,
            tts_suppression_until,
        );
    }

    if let Ok(text) = std::str::from_utf8(bytes) {
        if let Ok(payload) = serde_json::from_str::<Value>(text) {
            return cloud_voice_agent_emit_payload_frame(
                app,
                payload,
                pending_binary_audio,
                tts_suppression_until,
            );
        }
    }

    false
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

fn cloud_voice_agent_start_ready_result(payload: &Value) -> Option<Result<(), String>> {
    match cloud_voice_agent_event_kind(payload) {
        "voice_agent_stream_started" => Some(Ok(())),
        "voice_agent_error" => Some(Err(
            cloud_voice_agent_error_message(payload).unwrap_or_else(|| {
                "Cloud voice agent returned an error before the media stream was ready."
                    .to_string()
            }),
        )),
        "voice_agent_finished" => Some(Err(
            "Cloud voice agent finished before the media stream was ready.".to_string(),
        )),
        _ => None,
    }
}

fn cloud_voice_agent_resolve_ready(
    ready_tx: &mut Option<oneshot::Sender<Result<(), String>>>,
    result: Result<(), String>,
) {
    if let Some(ready_tx) = ready_tx.take() {
        let _ = ready_tx.send(result);
    }
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

async fn ensure_cloud_voice_agent_app_ws_ready(state: &CloudMcpState) -> Result<(), String> {
    cloud_mcp_wait_for_app_ws_auth(state).await.map(|_| ()).map_err(|error| {
        format!("Cloud voice agent requires the authenticated Cloud MCP app websocket before starting. {error}")
    })
}

fn cloud_voice_agent_desktop_logs_enabled() -> bool {
    env::var("RUST_DIFFFORGE_VOICE_ORCHESTRATOR_LOGS")
        .or_else(|_| env::var("DIFFFORGE_VOICE_ORCHESTRATOR_LOGS"))
        .ok()
        .map(|value| {
            let value = value.trim().to_ascii_lowercase();
            !matches!(value.as_str(), "0" | "false" | "off" | "no")
        })
        .unwrap_or(false)
}

fn cloud_voice_agent_desktop_log_action(action: &str) -> String {
    let action = clean_cloud_voice_agent_message_text(action.to_string(), 120)
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '_' || character == '-' {
                character.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect::<String>();
    let action = action.trim_matches('_');
    if action.is_empty() {
        return "voice_agent_desktop_log".to_string();
    }
    if action.starts_with("voice_agent_desktop_") {
        action.to_string()
    } else {
        format!("voice_agent_desktop_{action}")
    }
}

fn spawn_cloud_voice_agent_desktop_log(
    state: &CloudMcpState,
    action: &str,
    status: &str,
    reason: &str,
    voice_session_id: &str,
    workspace_id: &str,
    repo_id: &str,
    details: Value,
) {
    if !cloud_voice_agent_desktop_logs_enabled() {
        return;
    }

    let state = state.clone();
    let action = cloud_voice_agent_desktop_log_action(action);
    let status = clean_cloud_voice_agent_message_text(status.to_string(), 80);
    let reason = clean_cloud_voice_agent_message_text(reason.to_string(), 1200);
    let voice_session_id = clean_cloud_voice_agent_message_text(voice_session_id.to_string(), 180);
    let workspace_id = clean_cloud_voice_agent_message_text(workspace_id.to_string(), 180);
    let repo_id = clean_cloud_voice_agent_message_text(repo_id.to_string(), 180);
    let local_details = details.clone();
    let _ = state;
    log_voice_orchestrator_diagnostic_event(
        &action,
        json!({
            "status": status.clone(),
            "reason": reason.clone(),
            "voice_session_id": voice_session_id.clone(),
            "workspace_id": workspace_id.clone(),
            "repo_id": repo_id.clone(),
            "source": "rust-diffforge",
            "surface": "voice_agent",
            "transport": "voice_media_websocket",
            "details": local_details,
        }),
    );
}

#[tauri::command]
async fn prewarm_cloud_voice_agent_stream(
    cloud_mcp_state: State<'_, CloudMcpState>,
) -> Result<bool, String> {
    prewarm_cloud_voice_agent_stream_for_state(cloud_mcp_state.inner(), false).await
}

async fn prewarm_cloud_voice_agent_stream_for_state(
    cloud_mcp_state: &CloudMcpState,
    ensure_billing: bool,
) -> Result<bool, String> {
    log_audio_diagnostic_event("audio.cloud_voice.prewarm.command", json!({}));
    ensure_cloud_voice_agent_app_ws_ready(cloud_mcp_state).await?;
    if ensure_billing {
        let _ = cloud_mcp_get_billing_status_for_state(cloud_mcp_state).await;
    }
    let _ = cloud_mcp_ws_request_with_timeout(
        cloud_mcp_state,
        "voice_agent_prewarm",
        &json!({ "kind": "voice_agent_prewarm" }),
        Duration::from_secs(CLOUD_VOICE_AGENT_TEXT_CONNECT_TIMEOUT_SECS),
    )
    .await?;
    if forge_voice_route_cache_fresh(CLOUD_VOICE_AGENT_WS_PATH).is_some() {
        log_audio_diagnostic_event(
            "audio.cloud_voice.prewarm.cached",
            json!({ "ws_path": CLOUD_VOICE_AGENT_WS_PATH }),
        );
        return Ok(true);
    }
    let auth_bearer = cloud_mcp_authorization_bearer(cloud_mcp_state).await?;
    let ws_target = cloud_mcp_resolve_ws_target(
        cloud_mcp_state,
        &cloud_mcp_base_url(),
        CLOUD_VOICE_AGENT_WS_PATH,
    )
    .await
    .map_err(|error| format!("Cloud voice route unavailable: {error}"))?;
    forge_voice_route_cache_store(CLOUD_VOICE_AGENT_WS_PATH, &ws_target, &auth_bearer);
    log_audio_diagnostic_event(
        "audio.cloud_voice.prewarm.done",
        json!({
            "direct": ws_target.route_token.is_some(),
            "transport": ws_target.transport,
            "ws_path": CLOUD_VOICE_AGENT_WS_PATH,
        }),
    );
    Ok(true)
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
    let opened_target = ws_target.clone();
    let realtime_engine = start_request
        .get("realtime")
        .and_then(Value::as_bool)
        .unwrap_or_else(|| {
            start_request
                .get("voice_engine")
                .or_else(|| start_request.get("voiceEngine"))
                .and_then(Value::as_str)
                .map(|engine| {
                    matches!(
                        engine.trim().to_ascii_lowercase().as_str(),
                        "gpt_realtime" | "gpt-realtime" | "realtime"
                    )
                })
                .unwrap_or(false)
        });
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

    // Direct-only policy: the balancer never proxies websocket traffic; a
    // failed direct connect surfaces the error and the caller retries with a
    // freshly resolved route.
    let (ws_stream, _) = match connect_async(request).await {
        Ok(stream) => stream,
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

    log_audio_diagnostic_event(
        "audio.cloud_voice.start.sent",
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
    let mut peer_closed = false;
    let mut result_received = false;
    let mut tts_suppression_until: Option<Instant> = None;
    let mut pending_binary_audio: Option<Value> = None;
    let mut suppressed_audio_chunks = 0u64;
    let mut suppressed_audio_bytes = 0u64;
    loop {
        tokio::select! {
            maybe_control = control_rx.recv() => {
                match maybe_control {
                    Some(CloudVoiceAgentControl::FinishInput) => {
                        if ready_tx.is_some() {
                            cloud_voice_agent_resolve_ready(
                                &mut ready_tx,
                                Err("Cloud voice agent input finished before the media stream was ready.".to_string()),
                            );
                        }
                        if !input_finished_sent && !peer_closed {
                            let finish_message = json!({
                                "kind": "finish_input",
                                "voice_protocol": "diffforge.voice.realtime.v2",
                                "contract": "diffforge.voice_agent.v1",
                                "server_reconnect_grace_ms": CLOUD_VOICE_AGENT_SERVER_RECONNECT_GRACE_MS,
                                "openai_realtime_close_grace_ms": CLOUD_VOICE_AGENT_SERVER_RECONNECT_GRACE_MS,
                            });
                            if let Err(error) = write
                                .send(Message::Text(finish_message.to_string().into()))
                                .await
                            {
                                let error_text = error.to_string();
                                if is_expected_cloud_voice_agent_close_error(&error_text) {
                                    peer_closed = true;
                                } else {
                                    stream_error = Some(format!(
                                        "Unable to finish cloud voice agent input: {error_text}"
                                    ));
                                }
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
                        if ready_tx.is_some() {
                            cloud_voice_agent_resolve_ready(
                                &mut ready_tx,
                                Err("Cloud voice agent stream stopped before it was ready.".to_string()),
                            );
                        }
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
                    if ready_tx.is_some() {
                        cloud_voice_agent_resolve_ready(
                            &mut ready_tx,
                            Err("Cloud voice agent audio ended before the media stream was ready.".to_string()),
                        );
                    }
                    if !input_finished_sent && !peer_closed {
                        let finish_message = json!({
                            "kind": "finish_input",
                            "voice_protocol": "diffforge.voice.realtime.v2",
                            "contract": "diffforge.voice_agent.v1",
                            "server_reconnect_grace_ms": CLOUD_VOICE_AGENT_SERVER_RECONNECT_GRACE_MS,
                            "openai_realtime_close_grace_ms": CLOUD_VOICE_AGENT_SERVER_RECONNECT_GRACE_MS,
                        });
                        if let Err(error) = write
                            .send(Message::Text(finish_message.to_string().into()))
                            .await
                        {
                            let error_text = error.to_string();
                            if is_expected_cloud_voice_agent_close_error(&error_text) {
                                peer_closed = true;
                            } else {
                                stream_error = Some(format!(
                                    "Unable to finish cloud voice agent input after audio closed: {error_text}"
                                ));
                            }
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
                    if ready_tx.is_some() {
                        continue;
                    }
                    if !realtime_engine
                        && cloud_voice_agent_tts_suppression_active(tts_suppression_until)
                    {
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
                            let ready_result = cloud_voice_agent_start_ready_result(&payload);
                            if cloud_voice_agent_emit_payload_frame(
                                &app,
                                payload,
                                &mut pending_binary_audio,
                                &mut tts_suppression_until,
                            ) {
                                if ready_tx.is_some() {
                                    let error = ready_result
                                        .and_then(Result::err)
                                        .unwrap_or_else(|| {
                                            "Cloud voice agent ended before the media stream was ready.".to_string()
                                        });
                                    cloud_voice_agent_resolve_ready(&mut ready_tx, Err(error));
                                }
                                result_received = true;
                                break;
                            }
                            if let Some(result) = ready_result {
                                cloud_voice_agent_resolve_ready(&mut ready_tx, result);
                                log_audio_diagnostic_event(
                                    "audio.cloud_voice.start.ready",
                                    json!({
                                        "repo_id": repo_id,
                                        "sample_rate": sample_rate,
                                        "workspace_id": workspace_id,
                                    }),
                                );
                            }
                        }
                    }
                    Some(Ok(Message::Binary(bytes))) => {
                        let mut ready_result = None;
                        if let Ok(text) = std::str::from_utf8(bytes.as_ref()) {
                            if let Ok(payload) = serde_json::from_str::<Value>(text) {
                                ready_result = cloud_voice_agent_start_ready_result(&payload);
                            }
                        }
                        if cloud_voice_agent_emit_binary_frame(
                            &app,
                            bytes.as_ref(),
                            &mut pending_binary_audio,
                            &mut tts_suppression_until,
                        ) {
                            if ready_tx.is_some() {
                                let error = ready_result
                                    .and_then(Result::err)
                                    .unwrap_or_else(|| {
                                        "Cloud voice agent ended before the media stream was ready.".to_string()
                                    });
                                cloud_voice_agent_resolve_ready(&mut ready_tx, Err(error));
                            }
                            result_received = true;
                            break;
                        }
                        if let Some(result) = ready_result {
                            cloud_voice_agent_resolve_ready(&mut ready_tx, result);
                            log_audio_diagnostic_event(
                                "audio.cloud_voice.start.ready",
                                json!({
                                    "repo_id": repo_id,
                                    "sample_rate": sample_rate,
                                    "workspace_id": workspace_id,
                                }),
                            );
                        }
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        if let Err(error) = write.send(Message::Pong(payload)).await {
                            let error_text = error.to_string();
                            if is_expected_cloud_voice_agent_close_error(&error_text) {
                                peer_closed = true;
                            } else {
                                stream_error = Some(format!("Unable to answer cloud voice agent ping: {error_text}"));
                            }
                            if ready_tx.is_some() {
                                cloud_voice_agent_resolve_ready(
                                    &mut ready_tx,
                                    Err(stream_error.clone().unwrap_or_else(|| {
                                        "Cloud voice agent connection closed before the media stream was ready.".to_string()
                                    })),
                                );
                            }
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        peer_closed = true;
                        if ready_tx.is_some() {
                            cloud_voice_agent_resolve_ready(
                                &mut ready_tx,
                                Err("Cloud voice agent closed before the media stream was ready.".to_string()),
                            );
                        }
                        break;
                    }
                    Some(Err(error)) => {
                        let error_text = error.to_string();
                        if is_expected_cloud_voice_agent_close_error(&error_text) {
                            peer_closed = true;
                            if ready_tx.is_some() {
                                cloud_voice_agent_resolve_ready(
                                    &mut ready_tx,
                                    Err("Cloud voice agent connection closed before the media stream was ready.".to_string()),
                                );
                            }
                            break;
                        }
                        stream_error = Some(format!("Cloud voice agent stream failed: {error_text}"));
                        if ready_tx.is_some() {
                            cloud_voice_agent_resolve_ready(
                                &mut ready_tx,
                                Err(stream_error.clone().unwrap_or_else(|| {
                                    "Cloud voice agent stream failed before it was ready.".to_string()
                                })),
                            );
                        }
                        break;
                    }
                    _ => {}
                }
            }
        }
    }

    if ready_tx.is_some() {
        cloud_voice_agent_resolve_ready(
            &mut ready_tx,
            Err(stream_error.clone().unwrap_or_else(|| {
                if client_stop_requested {
                    "Cloud voice agent stream stopped before it was ready.".to_string()
                } else if peer_closed {
                    "Cloud voice agent connection closed before the media stream was ready."
                        .to_string()
                } else {
                    "Cloud voice agent stream ended before it was ready.".to_string()
                }
            })),
        );
    }

    if peer_closed && stream_error.is_none() && !client_stop_requested && !result_received {
        stream_error = Some(
            "Cloud voice agent connection closed before final response, plan, or error.".to_string(),
        );
    }

    if stream_error.is_none() && !client_stop_requested && !result_received && !peer_closed {
        if !input_finished_sent {
            let finish_message = json!({
                "kind": "finish_input",
                "voice_protocol": "diffforge.voice.realtime.v2",
                "contract": "diffforge.voice_agent.v1",
                "server_reconnect_grace_ms": CLOUD_VOICE_AGENT_SERVER_RECONNECT_GRACE_MS,
                "openai_realtime_close_grace_ms": CLOUD_VOICE_AGENT_SERVER_RECONNECT_GRACE_MS,
            });
            if let Err(error) = write
                .send(Message::Text(finish_message.to_string().into()))
                .await
            {
                let error_text = error.to_string();
                if is_expected_cloud_voice_agent_close_error(&error_text) {
                    peer_closed = true;
                    stream_error = Some(
                        "Cloud voice agent connection closed before result wait could start."
                            .to_string(),
                    );
                } else {
                    stream_error = Some(format!(
                        "Unable to finish cloud voice agent input before waiting for result: {error_text}"
                    ));
                }
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

    if stream_error.is_none() && !client_stop_requested && !result_received && !peer_closed {
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
                        break;
                    }
                }
                maybe_message = read.next() => {
                    match maybe_message {
                        Some(Ok(Message::Text(text))) => {
                            if let Ok(payload) = serde_json::from_str::<Value>(text.as_str()) {
                                if cloud_voice_agent_emit_payload_frame(
                                    &app,
                                    payload,
                                    &mut pending_binary_audio,
                                    &mut tts_suppression_until,
                                ) {
                                    result_received = true;
                                    break;
                                }
                            }
                        }
                        Some(Ok(Message::Binary(bytes))) => {
                            if cloud_voice_agent_emit_binary_frame(
                                &app,
                                bytes.as_ref(),
                                &mut pending_binary_audio,
                                &mut tts_suppression_until,
                            ) {
                                result_received = true;
                                break;
                            }
                        }
                        Some(Ok(Message::Ping(payload))) => {
                            if let Err(error) = write.send(Message::Pong(payload)).await {
                                let error_text = error.to_string();
                                if is_expected_cloud_voice_agent_close_error(&error_text) {
                                    peer_closed = true;
                                    stream_error = Some(
                                        "Cloud voice agent connection closed while waiting for result."
                                            .to_string(),
                                    );
                                } else {
                                    stream_error =
                                        Some(format!("Unable to answer cloud voice agent ping: {error_text}"));
                                }
                                break;
                            }
                        }
                        Some(Ok(Message::Close(_))) | None => {
                            peer_closed = true;
                            stream_error = Some(
                                "Cloud voice agent connection closed before final response, plan, or error."
                                    .to_string(),
                            );
                            break;
                        }
                        Some(Err(error)) => {
                            let error_text = error.to_string();
                            if is_expected_cloud_voice_agent_close_error(&error_text) {
                                peer_closed = true;
                                stream_error = Some(
                                    "Cloud voice agent connection closed while waiting for result."
                                        .to_string(),
                                );
                            } else {
                                stream_error = Some(format!(
                                    "Cloud voice agent stream failed: {error_text}"
                                ));
                            }
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

    if !peer_closed {
        let stop_message = json!({
            "kind": "stop",
            "voice_protocol": "diffforge.voice.realtime.v2",
            "contract": "diffforge.voice_agent.v1",
            "server_reconnect_grace_ms": CLOUD_VOICE_AGENT_SERVER_RECONNECT_GRACE_MS,
            "openai_realtime_close_grace_ms": CLOUD_VOICE_AGENT_SERVER_RECONNECT_GRACE_MS,
        });
        if let Err(error) = write
            .send(Message::Text(stop_message.to_string().into()))
            .await
        {
            let error_text = error.to_string();
            if is_expected_cloud_voice_agent_close_error(&error_text) {
                peer_closed = true;
            } else if stream_error.is_none() {
                stream_error = Some(format!(
                    "Unable to stop cloud voice agent stream: {error_text}"
                ));
            }
        }
    }

    if stream_error.is_none() && !peer_closed {
        loop {
            match timeout(
                Duration::from_secs(DEEPGRAM_CLOSE_TIMEOUT_SECS),
                read.next(),
            )
            .await
            {
                Ok(Some(Ok(Message::Text(text)))) => {
                    if let Ok(payload) = serde_json::from_str::<Value>(text.as_str()) {
                        let _ = cloud_voice_agent_emit_payload_frame(
                            &app,
                            payload,
                            &mut pending_binary_audio,
                            &mut tts_suppression_until,
                        );
                    }
                }
                Ok(Some(Ok(Message::Binary(bytes)))) => {
                    let _ = cloud_voice_agent_emit_binary_frame(
                        &app,
                        bytes.as_ref(),
                        &mut pending_binary_audio,
                        &mut tts_suppression_until,
                    );
                }
                Ok(Some(Ok(Message::Ping(payload)))) => {
                    if let Err(error) = write.send(Message::Pong(payload)).await {
                        let error_text = error.to_string();
                        if !is_expected_cloud_voice_agent_close_error(&error_text) {
                            stream_error =
                                Some(format!("Unable to answer cloud voice agent ping: {error_text}"));
                        }
                        break;
                    }
                }
                Ok(Some(Ok(Message::Close(_)))) | Ok(None) | Err(_) => {
                    break;
                }
                Ok(Some(Err(error))) => {
                    let error_text = error.to_string();
                    if is_expected_cloud_voice_agent_close_error(&error_text) {
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
    let opened_target = ws_target.clone();
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

    // Direct-only policy: the balancer never proxies websocket traffic; a
    // failed direct connect surfaces the error and the caller retries with a
    // freshly resolved route.
    let (ws_stream, _) = match connect_async(request).await {
        Ok(stream) => stream,
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
    let mut pending_binary_audio: Option<Value> = None;
    let result_deadline = sleep(Duration::from_secs(CLOUD_VOICE_AGENT_RESULT_TIMEOUT_SECS));
    tokio::pin!(result_deadline);

    loop {
        tokio::select! {
            maybe_message = read.next() => {
                match maybe_message {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(payload) = serde_json::from_str::<Value>(text.as_str()) {
                            if cloud_voice_agent_emit_payload_frame(
                                &app,
                                payload,
                                &mut pending_binary_audio,
                                &mut tts_suppression_until,
                            ) {
                                result_received = true;
                                break;
                            }
                        }
                    }
                    Some(Ok(Message::Binary(bytes))) => {
                        if cloud_voice_agent_emit_binary_frame(
                            &app,
                            bytes.as_ref(),
                            &mut pending_binary_audio,
                            &mut tts_suppression_until,
                        ) {
                            result_received = true;
                            break;
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
            "voice_protocol": "diffforge.voice.realtime.v2",
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
    let CloudVoiceAgentStartRequest {
        repo_id,
        submission_mode,
        workspace_id,
        workspace_name,
        workspace_root,
        realtime,
    } = request;
    let realtime_engine = realtime.unwrap_or(false);
    let submission_mode = normalize_cloud_voice_agent_submission_mode(submission_mode);
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

    let voice_session_id = format!("voice-{}", uuid::Uuid::new_v4());
    spawn_cloud_voice_agent_desktop_log(
        cloud_mcp_state.inner(),
        "start_command_received",
        "start",
        "Rust desktop received a command to start the cloud voice orchestrator over the voice media websocket.",
        &voice_session_id,
        &workspace_id,
        &repo_id,
        json!({
            "submission_mode": submission_mode.clone(),
            "workspace_name": workspace_name.clone(),
            "workspace_root": workspace_root.clone(),
        }),
    );
    // A freshly cached voice route (under the cache TTL) skips the serial
    // app-ws auth wait, bearer prep, device heartbeat, and balancer round
    // trip; a failed connect surfaces normally and the retry resolves fresh.
    let (ws_target, auth_bearer) =
        match forge_voice_route_cache_fresh(CLOUD_VOICE_AGENT_WS_PATH) {
            Some((ws_target, auth_bearer)) => {
                spawn_cloud_voice_agent_desktop_log(
                    cloud_mcp_state.inner(),
                    "voice_media_route_resolved",
                    "ok",
                    "Rust desktop reused the freshly cached cloud voice media websocket route.",
                    &voice_session_id,
                    &workspace_id,
                    &repo_id,
                    json!({
                        "direct": ws_target.route_token.is_some(),
                        "transport": ws_target.transport.clone(),
                        "cached": true,
                    }),
                );
                (ws_target, auth_bearer)
            }
            None => {
                match ensure_cloud_voice_agent_app_ws_ready(cloud_mcp_state.inner()).await {
                    Ok(()) => {
                        spawn_cloud_voice_agent_desktop_log(
                            cloud_mcp_state.inner(),
                            "app_ws_auth_ready",
                            "ok",
                            "Rust desktop confirmed authenticated app websocket readiness before voice streaming.",
                            &voice_session_id,
                            &workspace_id,
                            &repo_id,
                            json!({}),
                        );
                    }
                    Err(error) => {
                        spawn_cloud_voice_agent_desktop_log(
                            cloud_mcp_state.inner(),
                            "app_ws_auth_not_ready",
                            "error",
                            &error,
                            &voice_session_id,
                            &workspace_id,
                            &repo_id,
                            json!({}),
                        );
                        return Err(error);
                    }
                }
                let auth_bearer = match cloud_mcp_authorization_bearer(cloud_mcp_state.inner())
                    .await
                {
                    Ok(token) => token,
                    Err(error) => {
                        spawn_cloud_voice_agent_desktop_log(
                            cloud_mcp_state.inner(),
                            "voice_media_auth_failed",
                            "error",
                            &error,
                            &voice_session_id,
                            &workspace_id,
                            &repo_id,
                            json!({}),
                        );
                        return Err(error);
                    }
                };
                let ws_target = match cloud_mcp_resolve_ws_target(
                    cloud_mcp_state.inner(),
                    &cloud_mcp_base_url(),
                    CLOUD_VOICE_AGENT_WS_PATH,
                )
                .await
                {
                    Ok(target) => target,
                    Err(error) => {
                        let message = format!("Cloud voice route unavailable: {error}");
                        spawn_cloud_voice_agent_desktop_log(
                            cloud_mcp_state.inner(),
                            "voice_media_route_resolved",
                            "error",
                            &message,
                            &voice_session_id,
                            &workspace_id,
                            &repo_id,
                            json!({}),
                        );
                        return Err(message);
                    }
                };
                forge_voice_route_cache_store(CLOUD_VOICE_AGENT_WS_PATH, &ws_target, &auth_bearer);
                spawn_cloud_voice_agent_desktop_log(
                    cloud_mcp_state.inner(),
                    "voice_media_route_resolved",
                    "ok",
                    "Rust desktop resolved the dedicated cloud voice media websocket route.",
                    &voice_session_id,
                    &workspace_id,
                    &repo_id,
                    json!({
                        "direct": ws_target.route_token.is_some(),
                        "transport": ws_target.transport.clone(),
                    }),
                );
                (ws_target, auth_bearer)
            }
        };

    let (audio_tx, audio_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let (ready_tx, ready_rx) = oneshot::channel();
    let (finished_tx, finished_rx) = oneshot::channel();
    let (control_tx, control_rx) = mpsc::unbounded_channel::<CloudVoiceAgentControl>();

    let status = {
        let _realtime_guard = audio_state.realtime_stream_lock.lock().await;
        let mut session_guard = audio_state.cloud_voice_agent_stream.lock().await;
        if let Some(session) = session_guard.as_mut() {
            match session.finished_rx.try_recv() {
                Ok(_) | Err(tokio::sync::oneshot::error::TryRecvError::Closed) => {
                    *session_guard = None;
                    audio_state
                        .cloud_voice_agent_input_enabled
                        .store(false, Ordering::SeqCst);
                    let _ = realtime_mic_detach_for(&audio_state, RealtimeMicHolder::VoiceAgent);
                }
                Err(tokio::sync::oneshot::error::TryRecvError::Empty) => {}
            }
        }
        if session_guard.is_some() {
            return Err("Cloud voice agent stream is already active.".to_string());
        }
        if audio_state.deepgram_stream.lock().await.is_some() {
            return Err("Deepgram realtime transcription is already active.".to_string());
        }
        // Mic arbitration is one-directional on purpose: dictation may borrow
        // the mic from a live agent session, but a new agent session must not
        // steal the mic from an in-flight dictation.
        if audio_state.forge_dictation_stream.lock().await.is_some() {
            return Err(
                "Diff Forge Cloud dictation is active. Finish dictating before starting the voice agent."
                    .to_string(),
            );
        }

        let session_audio_tx = audio_tx.clone();
        let status = match audio_state.input_worker.attach_realtime_stream(audio_tx) {
            Ok(status) => status,
            Err(error) => {
                spawn_cloud_voice_agent_desktop_log(
                    cloud_mcp_state.inner(),
                    "audio_input_attach_failed",
                    "error",
                    &error,
                    &voice_session_id,
                    &workspace_id,
                    &repo_id,
                    json!({}),
                );
                return Err(error);
            }
        };
        realtime_mic_holder_set(&audio_state, RealtimeMicHolder::VoiceAgent);
        audio_state
            .cloud_voice_agent_input_enabled
            .store(true, Ordering::SeqCst);
        spawn_cloud_voice_agent_desktop_log(
            cloud_mcp_state.inner(),
            "audio_input_attached",
            "ok",
            "Rust desktop attached the microphone input stream for cloud voice forwarding.",
            &voice_session_id,
            &workspace_id,
            &repo_id,
            json!({
                "sample_rate": status.sample_rate,
            }),
        );
        let device_profile = cloud_mcp_desktop_device_profile();
        let agent_session_context = cloud_mcp_agent_session_context_for_voice(&workspace_id);
        let start_request = json!({
            "kind": "start",
            "contract": CLOUD_VOICE_AGENT_CONTRACT,
            "voice_protocol": "diffforge.voice.realtime.v2",
            // GPT-Realtime engine opt-in (cloud falls back to the pipeline
            // when its env kill switch is set).
            "realtime": realtime_engine,
            "voice_engine": if realtime_engine { "gpt_realtime" } else { "pipeline" },
            "server_reconnect_grace_ms": CLOUD_VOICE_AGENT_SERVER_RECONNECT_GRACE_MS,
            "openai_realtime_close_grace_ms": CLOUD_VOICE_AGENT_SERVER_RECONNECT_GRACE_MS,
            "realtime_session": {
                "reconnect_grace_ms": CLOUD_VOICE_AGENT_SERVER_RECONNECT_GRACE_MS,
                "openai_close_grace_ms": CLOUD_VOICE_AGENT_SERVER_RECONNECT_GRACE_MS,
            },
            "voice_session_id": voice_session_id.clone(),
            "device_id": device_profile["device_id"].clone(),
            "machine_id": device_profile["device_id"].clone(),
            "device": device_profile,
            "workspace_id": workspace_id.clone(),
            "workspace_name": workspace_name.clone(),
            "workspace_root": workspace_root.clone(),
            "repo_id": repo_id.clone(),
            "agent_session_context": agent_session_context.clone(),
            "agentSessionContext": agent_session_context.clone(),
            "recent_agent_sessions": agent_session_context["sessions"].clone(),
            "recentAgentSessions": agent_session_context["sessions"].clone(),
            "submission_mode": submission_mode.clone(),
            "input_mode": submission_mode.clone(),
            "turn_policy": {
                "input_submission": submission_mode.clone(),
            },
            "tts": {
                "enabled": true,
                "provider": "deepgram_aura",
                "stream": true,
            },
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
                "allowed_tools": ["create_plan", "open_coding_agents", "dispatch_remote_tasks", "device_control", "highlight_terminal"],
                "context_sources": ["recent_agent_sessions"],
                "recent_agent_session_limit": CLOUD_MCP_AGENT_SESSION_CONTEXT_LIMIT,
                "agent_session_summary_policy": {
                    "mode": "todos_with_cloud_llm_compression",
                    "chunk_size": CLOUD_MCP_AGENT_SESSION_TODO_CHUNK_SIZE,
                    "summary_item_limit": CLOUD_MCP_AGENT_SESSION_SUMMARY_ITEM_LIMIT,
                    "recent_raw_todo_limit": CLOUD_MCP_AGENT_SESSION_RECENT_RAW_TODO_LIMIT,
                    "compression": "cloud_llm",
                    "open_coding_agents_accepts_context": true,
                    "highlight_terminal_accepts_context": true,
                },
                "tool_choice": "auto",
                "response_contract": {
                    "immediate_feedback_required": true,
                    "main_response_required": true,
                    "main_response_may_call_tool": true,
                    "regular_response_kind": "voice_agent_llm_feedback",
                    "plan_tool_name": "create_plan",
                    "agent_open_tool_name": "open_coding_agents",
                    "terminal_highlight_tool_name": "highlight_terminal",
                    "remote_dispatch_tool_name": "dispatch_remote_tasks",
                    "plan_snapshot_kind": "voice_agent_plan_snapshot"
                }
            },
            "audio": {
                "encoding": "linear16",
                "sample_rate": status.sample_rate,
                "channels": 1,
            },
        });
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
        *session_guard = Some(CloudVoiceAgentSession {
            audio_tx: session_audio_tx,
            control_tx,
            finished_rx,
        });
        status
    };

    let ready_failure: Option<(&'static str, String, Value)> = match timeout(
        Duration::from_secs(CLOUD_VOICE_AGENT_STREAM_START_TIMEOUT_SECS),
        ready_rx,
    )
    .await
    {
        Ok(Ok(Ok(()))) => None,
        Ok(Ok(Err(error))) => Some(("start_ready_failed", error, json!({}))),
        Ok(Err(_closed)) => Some((
            "start_ready_channel_closed",
            "Cloud voice agent stream closed before it was ready.".to_string(),
            json!({}),
        )),
        Err(_elapsed) => Some((
            "start_ready_timeout",
            "Cloud voice agent did not acknowledge the voice media websocket start request.".to_string(),
            json!({
                "timeout_secs": CLOUD_VOICE_AGENT_STREAM_START_TIMEOUT_SECS,
            }),
        )),
    };

    if let Some((action, error, details)) = ready_failure {
        {
            let _realtime_guard = audio_state.realtime_stream_lock.lock().await;
            let mut session_guard = audio_state.cloud_voice_agent_stream.lock().await;
            *session_guard = None;
            audio_state
                .cloud_voice_agent_input_enabled
                .store(false, Ordering::SeqCst);
            let _ = realtime_mic_detach_for(&audio_state, RealtimeMicHolder::VoiceAgent);
        }
        spawn_cloud_voice_agent_desktop_log(
            cloud_mcp_state.inner(),
            action,
            "error",
            &error,
            &voice_session_id,
            &workspace_id,
            &repo_id,
            details,
        );
        return Err(error);
    }

    spawn_cloud_voice_agent_desktop_log(
        cloud_mcp_state.inner(),
        "start_command_ready",
        "ok",
        "Rust desktop marked the cloud voice stream as active for the UI.",
        &voice_session_id,
        &workspace_id,
        &repo_id,
        json!({
            "sample_rate": status.sample_rate,
        }),
    );

    Ok(CloudVoiceAgentStartStatus {
        active: true,
        repo_id,
        sample_rate: status.sample_rate,
        workspace_id,
    })
}

#[tauri::command]
async fn set_cloud_voice_agent_input_enabled(
    app: AppHandle,
    audio_state: State<'_, AudioState>,
    enabled: bool,
) -> Result<Value, String> {
    log_audio_diagnostic_event(
        "audio.cloud_voice.input_enabled.command",
        json!({ "enabled": enabled }),
    );
    let _realtime_guard = audio_state.realtime_stream_lock.lock().await;

    if !enabled {
        audio_state
            .cloud_voice_agent_input_enabled
            .store(false, Ordering::SeqCst);
        realtime_mic_detach_for(&audio_state, RealtimeMicHolder::VoiceAgent)?;
        let active = audio_state.cloud_voice_agent_stream.lock().await.is_some();
        emit_voice_agent_mic_event(&app, "paused", "user_toggle");
        log_audio_diagnostic_event(
            "audio.cloud_voice.input_enabled.paused",
            json!({ "active": active }),
        );
        return Ok(json!({
            "active": active,
            "enabled": false,
            "mic_attached": false,
        }));
    }

    let audio_tx = {
        let mut session_guard = audio_state.cloud_voice_agent_stream.lock().await;
        let Some(session) = session_guard.as_mut() else {
            audio_state
                .cloud_voice_agent_input_enabled
                .store(false, Ordering::SeqCst);
            log_audio_diagnostic_event("audio.cloud_voice.input_enabled.inactive", json!({}));
            return Err("Cloud voice agent stream is not active.".to_string());
        };
        match session.finished_rx.try_recv() {
            Ok(_) | Err(tokio::sync::oneshot::error::TryRecvError::Closed) => {
                *session_guard = None;
                audio_state
                    .cloud_voice_agent_input_enabled
                    .store(false, Ordering::SeqCst);
                let _ = realtime_mic_detach_for(&audio_state, RealtimeMicHolder::VoiceAgent);
                log_audio_diagnostic_event("audio.cloud_voice.input_enabled.finished", json!({}));
                return Err("Cloud voice agent stream has already finished.".to_string());
            }
            Err(tokio::sync::oneshot::error::TryRecvError::Empty) => session.audio_tx.clone(),
        }
    };

    match realtime_mic_holder_get(&audio_state) {
        RealtimeMicHolder::VoiceAgent => {
            audio_state
                .cloud_voice_agent_input_enabled
                .store(true, Ordering::SeqCst);
            emit_voice_agent_mic_event(&app, "resumed", "user_toggle");
            log_audio_diagnostic_event(
                "audio.cloud_voice.input_enabled.already_attached",
                json!({}),
            );
            Ok(json!({
                "active": true,
                "enabled": true,
                "mic_attached": true,
            }))
        }
        RealtimeMicHolder::Dictation => {
            audio_state
                .cloud_voice_agent_input_enabled
                .store(true, Ordering::SeqCst);
            emit_voice_agent_mic_event(&app, "paused", "dictation_active");
            log_audio_diagnostic_event(
                "audio.cloud_voice.input_enabled.waiting_for_dictation",
                json!({}),
            );
            Ok(json!({
                "active": true,
                "enabled": true,
                "mic_attached": false,
                "reason": "dictation_active",
            }))
        }
        RealtimeMicHolder::Deepgram => {
            // Own-key Deepgram dictation is a borrower like Forge dictation:
            // its teardown hands the mic back, so enabling agent input waits
            // instead of failing.
            audio_state
                .cloud_voice_agent_input_enabled
                .store(true, Ordering::SeqCst);
            emit_voice_agent_mic_event(&app, "paused", "dictation_active");
            log_audio_diagnostic_event(
                "audio.cloud_voice.input_enabled.waiting_for_dictation",
                json!({ "holder": "deepgram" }),
            );
            Ok(json!({
                "active": true,
                "enabled": true,
                "mic_attached": false,
                "reason": "dictation_active",
            }))
        }
        RealtimeMicHolder::None => {
            match audio_state.input_worker.attach_realtime_stream_silent(audio_tx) {
                Ok(_) => {
                    realtime_mic_holder_set(&audio_state, RealtimeMicHolder::VoiceAgent);
                    audio_state
                        .cloud_voice_agent_input_enabled
                        .store(true, Ordering::SeqCst);
                    emit_voice_agent_mic_event(&app, "resumed", "user_toggle");
                    log_audio_diagnostic_event(
                        "audio.cloud_voice.input_enabled.resumed",
                        json!({}),
                    );
                    Ok(json!({
                        "active": true,
                        "enabled": true,
                        "mic_attached": true,
                    }))
                }
                Err(error) => {
                    audio_state
                        .cloud_voice_agent_input_enabled
                        .store(false, Ordering::SeqCst);
                    log_audio_diagnostic_event(
                        "audio.cloud_voice.input_enabled.resume_failed",
                        json!({ "error": error }),
                    );
                    Err(error)
                }
            }
        }
    }
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

    let voice_session_id = format!("voice-{}", uuid::Uuid::new_v4());
    spawn_cloud_voice_agent_desktop_log(
        cloud_mcp_state.inner(),
        "text_message_command_received",
        "start",
        "Rust desktop received a text message command for the cloud voice orchestrator over the voice media websocket.",
        &voice_session_id,
        &workspace_id,
        &repo_id,
        json!({
            "text_chars": text.chars().count(),
            "turn_index": turn_index.unwrap_or(0),
            "workspace_name": workspace_name.clone(),
            "workspace_root": workspace_root.clone(),
        }),
    );
    match ensure_cloud_voice_agent_app_ws_ready(cloud_mcp_state.inner()).await {
        Ok(()) => {
            spawn_cloud_voice_agent_desktop_log(
                cloud_mcp_state.inner(),
                "text_message_app_ws_auth_ready",
                "ok",
                "Rust desktop confirmed authenticated app websocket readiness before sending the voice text message.",
                &voice_session_id,
                &workspace_id,
                &repo_id,
                json!({}),
            );
        }
        Err(error) => {
            spawn_cloud_voice_agent_desktop_log(
                cloud_mcp_state.inner(),
                "text_message_app_ws_auth_not_ready",
                "error",
                &error,
                &voice_session_id,
                &workspace_id,
                &repo_id,
                json!({}),
            );
            return Err(error);
        }
    }
    let auth_bearer = match cloud_mcp_authorization_bearer(cloud_mcp_state.inner()).await {
        Ok(token) => token,
        Err(error) => {
            spawn_cloud_voice_agent_desktop_log(
                cloud_mcp_state.inner(),
                "text_message_voice_media_auth_failed",
                "error",
                &error,
                &voice_session_id,
                &workspace_id,
                &repo_id,
                json!({}),
            );
            return Err(error);
        }
    };
    let ws_target = match cloud_mcp_resolve_ws_target(
        cloud_mcp_state.inner(),
        &cloud_mcp_base_url(),
        CLOUD_VOICE_AGENT_WS_PATH,
    )
    .await
    {
        Ok(target) => target,
        Err(error) => {
            let message = format!("Cloud voice route unavailable: {error}");
            spawn_cloud_voice_agent_desktop_log(
                cloud_mcp_state.inner(),
                "text_message_voice_media_route_resolved",
                "error",
                &message,
                &voice_session_id,
                &workspace_id,
                &repo_id,
                json!({}),
            );
            return Err(message);
        }
    };
    spawn_cloud_voice_agent_desktop_log(
        cloud_mcp_state.inner(),
        "text_message_voice_media_route_resolved",
        "ok",
        "Rust desktop resolved the dedicated cloud voice media websocket route for chat.",
        &voice_session_id,
        &workspace_id,
        &repo_id,
        json!({
            "direct": ws_target.route_token.is_some(),
            "transport": ws_target.transport.clone(),
        }),
    );
    let device_profile = cloud_mcp_desktop_device_profile();
    let text_request = json!({
        "kind": "text_message",
        "contract": CLOUD_VOICE_AGENT_CONTRACT,
        "voice_protocol": "diffforge.voice.realtime.v2",
        "voice_session_id": voice_session_id,
        "device_id": device_profile["device_id"].clone(),
        "machine_id": device_profile["device_id"].clone(),
        "device": device_profile,
        "text": text,
        "turn_index": turn_index.unwrap_or(0),
        "workspace_id": workspace_id.clone(),
        "workspace_name": workspace_name,
        "workspace_root": workspace_root,
        "repo_id": repo_id.clone(),
        "tts": {
            "enabled": true,
            "provider": "deepgram_aura",
            "stream": true,
        },
        "llm_orchestrator_policy": cloud_voice_agent_llm_orchestrator_policy(),
    });
    let (ready_tx, ready_rx) = oneshot::channel();
    tauri::async_runtime::spawn(run_cloud_voice_agent_text_message(
        app,
        ws_target,
        auth_bearer,
        text_request,
        workspace_id.clone(),
        repo_id.clone(),
        ready_tx,
    ));

    match timeout(
        Duration::from_secs(CLOUD_VOICE_AGENT_TEXT_CONNECT_TIMEOUT_SECS),
        ready_rx,
    )
    .await
    {
        Ok(Ok(Ok(()))) => Ok(()),
        Ok(Ok(Err(error))) => Err(error),
        Ok(Err(_closed)) => Err("Cloud voice agent chat closed before it was ready.".to_string()),
        Err(_elapsed) => Err("Cloud voice agent chat timed out while connecting.".to_string()),
    }
}

#[tauri::command]
async fn stop_cloud_voice_agent_stream(audio_state: State<'_, AudioState>) -> Result<(), String> {
    log_audio_diagnostic_event("audio.cloud_voice.stop.command", json!({}));
    #[cfg(target_os = "macos")]
    macos_voice_playback_clear();
    let _realtime_guard = audio_state.realtime_stream_lock.lock().await;
    let session = {
        let mut session_guard = audio_state.cloud_voice_agent_stream.lock().await;
        session_guard.take()
    };
    let Some(session) = session else {
        audio_state
            .cloud_voice_agent_input_enabled
            .store(false, Ordering::SeqCst);
        log_audio_diagnostic_event("audio.cloud_voice.stop.inactive", json!({}));
        return Ok(());
    };

    audio_state
        .cloud_voice_agent_input_enabled
        .store(false, Ordering::SeqCst);
    let _ = session.control_tx.send(CloudVoiceAgentControl::Stop);
    // Guarded detach: when dictation borrowed the mic, the agent no longer
    // owns it and must leave dictation's feed untouched.
    realtime_mic_detach_for(&audio_state, RealtimeMicHolder::VoiceAgent)?;

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
            audio_state
                .cloud_voice_agent_input_enabled
                .store(false, Ordering::SeqCst);
            log_audio_diagnostic_event("audio.cloud_voice.finish_input.inactive", json!({}));
            return Ok(());
        };
        session.control_tx.clone()
    };

    audio_state
        .cloud_voice_agent_input_enabled
        .store(false, Ordering::SeqCst);
    let _ = control_tx.send(CloudVoiceAgentControl::FinishInput);
    realtime_mic_detach_for(&audio_state, RealtimeMicHolder::VoiceAgent)?;
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
    let keyterms = voice_dictionary_bias_terms(&app);
    let mut request = match deepgram_realtime_url(&language, sample_rate, &keyterms).into_client_request() {
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

    if let Some(session) = session_guard.as_mut() {
        // Reap a session that ended without a stop command (for example a
        // dropped websocket) instead of refusing the new start.
        match session.finished_rx.try_recv() {
            Ok(_) | Err(tokio::sync::oneshot::error::TryRecvError::Closed) => {
                *session_guard = None;
                let _ = realtime_mic_detach_for(&audio_state, RealtimeMicHolder::Deepgram);
            }
            Err(tokio::sync::oneshot::error::TryRecvError::Empty) => {}
        }
    }
    if session_guard.is_some() {
        return Err("Deepgram realtime transcription is already active.".to_string());
    }
    {
        let mut dictation_guard = audio_state.forge_dictation_stream.lock().await;
        if let Some(session) = dictation_guard.as_mut() {
            match session.finished_rx.try_recv() {
                Ok(_) | Err(tokio::sync::oneshot::error::TryRecvError::Closed) => {
                    *dictation_guard = None;
                    let _ = realtime_mic_detach_for(&audio_state, RealtimeMicHolder::Dictation);
                }
                Err(tokio::sync::oneshot::error::TryRecvError::Empty) => {}
            }
        }
        if dictation_guard.is_some() {
            return Err("Diff Forge Cloud dictation is already active.".to_string());
        }
    }

    // Mic arbitration: a live voice agent session no longer blocks the
    // own-key Deepgram stream. This path is its own websocket straight to
    // Deepgram (separate from the cloud control and voice agent sockets), so
    // the only shared resource is the microphone — borrow it like Forge
    // dictation does and hand it back on teardown. Dead agent sessions
    // (provider switch, dropped socket) are reaped instead of blocking.
    let mut borrowed_from_voice_agent = false;
    {
        let mut agent_guard = audio_state.cloud_voice_agent_stream.lock().await;
        if let Some(agent) = agent_guard.as_mut() {
            match agent.finished_rx.try_recv() {
                Ok(_) | Err(tokio::sync::oneshot::error::TryRecvError::Closed) => {
                    *agent_guard = None;
                    let _ = realtime_mic_detach_for(&audio_state, RealtimeMicHolder::VoiceAgent);
                }
                Err(tokio::sync::oneshot::error::TryRecvError::Empty) => {
                    if realtime_mic_holder_get(&audio_state) == RealtimeMicHolder::VoiceAgent {
                        borrowed_from_voice_agent = true;
                    }
                }
            }
        }
    }

    let (audio_tx, audio_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let status = audio_state.input_worker.attach_realtime_stream(audio_tx)?;
    realtime_mic_holder_set(&audio_state, RealtimeMicHolder::Deepgram);
    audio_state
        .deepgram_mic_borrowed
        .store(borrowed_from_voice_agent, Ordering::SeqCst);
    if borrowed_from_voice_agent {
        emit_voice_agent_mic_event(&app, "paused", "dictation_started");
        log_audio_diagnostic_event("audio.cloud_voice.mic.paused", json!({}));
    }
    let (ready_tx, ready_rx) = oneshot::channel();
    let (finished_tx, finished_rx) = oneshot::channel();

    tauri::async_runtime::spawn(run_deepgram_realtime_stream(
        app.clone(),
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
            deepgram_release_mic(&app, &audio_state).await;
            return Err(error);
        }
        Ok(Err(_closed)) => {
            deepgram_release_mic(&app, &audio_state).await;
            return Err("Deepgram realtime stream closed before it was ready.".to_string());
        }
        Err(_elapsed) => {
            deepgram_release_mic(&app, &audio_state).await;
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
    app: AppHandle,
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

    // Detach and hand the mic back when a live voice agent session lent it.
    deepgram_release_mic(&app, &audio_state).await;

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

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct ForgeDictationStartRequest {
    llm_cleanup: Option<bool>,
    language: Option<String>,
    history_id: Option<String>,
    history_created_at: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct ForgeDictationStopRequest {
    cancel: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ForgeDictationStartStatus {
    active: bool,
    language: String,
    model: String,
    sample_rate: u32,
    llm_cleanup: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct ForgeDictationResult {
    text: String,
    raw_text: String,
    cancelled: bool,
    llm_cleaned: bool,
    audio_seconds: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct ForgeDictationRawResultEvent {
    history_id: String,
    created_at: String,
    text: String,
    raw_text: String,
    cleanup_pending: bool,
    llm_cleanup_requested: bool,
    audio_seconds: i64,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct AudioTranscriptionPolishRequest {
    text: String,
    fallback_text: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct AudioTranscriptionPolishResult {
    text: String,
    raw_text: String,
    llm_cleaned: bool,
    cleanup_ms: u64,
    model: String,
}

fn audio_transcription_polish_clipboard_text() -> Result<String, String> {
    let mut clipboard = arboard::Clipboard::new()
        .map_err(|error| format!("Unable to open system clipboard: {error}"))?;
    clipboard
        .get_text()
        .map_err(|_| "Clipboard does not contain text to polish.".to_string())
}

fn write_audio_transcription_polish_clipboard_text(text: &str) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new()
        .map_err(|error| format!("Unable to open system clipboard: {error}"))?;
    clipboard
        .set_text(text.to_string())
        .map_err(|error| format!("Transcript polished, but clipboard update failed: {error}"))
}

fn audio_transcription_polish_source_text(
    request: AudioTranscriptionPolishRequest,
) -> Result<String, String> {
    if !request.text.trim().is_empty() {
        return Ok(request.text);
    }

    let fallback_text = request.fallback_text.trim().to_string();
    match audio_transcription_polish_clipboard_text() {
        Ok(clipboard_text) if !clipboard_text.trim().is_empty() => Ok(clipboard_text),
        Ok(_) if !fallback_text.is_empty() => Ok(fallback_text),
        Ok(_) => Err("Clipboard does not contain text to polish, and there is no recent transcript.".to_string()),
        Err(_) if !fallback_text.is_empty() => Ok(fallback_text),
        Err(_) => Err(
            "Clipboard does not contain text to polish, and there is no recent transcript."
                .to_string(),
        ),
    }
}

fn forge_dictation_result_from_payload(
    payload: &Value,
    cancel_requested: bool,
) -> Result<ForgeDictationResult, String> {
    let text = payload
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    let raw_text = payload
        .get("raw_text")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();

    if text.is_empty() && raw_text.is_empty() {
        if let Some(error) = payload
            .get("error")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|error| !error.is_empty())
        {
            return Err(error.to_string());
        }
    }

    Ok(ForgeDictationResult {
        text: if text.is_empty() { raw_text.clone() } else { text },
        raw_text,
        cancelled: payload
            .get("cancelled")
            .and_then(Value::as_bool)
            .unwrap_or(cancel_requested),
        llm_cleaned: payload
            .get("llm_cleaned")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        audio_seconds: payload
            .get("audio_seconds")
            .and_then(Value::as_i64)
            .unwrap_or(0),
    })
}

/// How the dictation stream task reaches Diff Forge Cloud: a warm parked
/// socket claimed from the prewarm pool (instant), or a cold connect with a
/// freshly resolved route (fallback).
enum ForgeDictationConnection {
    Warm(ForgeDictationWsStream),
    Cold {
        ws_target: CloudMcpWsTarget,
        auth_bearer: Option<String>,
    },
}

async fn resolve_forge_dictation_cloud_route(
    cloud_mcp_state: &CloudMcpState,
) -> Result<(CloudMcpWsTarget, Option<String>), String> {
    cloud_mcp_wait_for_app_ws_auth(cloud_mcp_state)
        .await
        .map(|_| ())
        .map_err(|error| {
            format!("Diff Forge Cloud dictation needs the signed-in Diff Forge AI connection. {error}")
        })?;
    let auth_bearer = cloud_mcp_authorization_bearer(cloud_mcp_state).await?;
    let ws_target = cloud_mcp_resolve_ws_target(
        cloud_mcp_state,
        &cloud_mcp_base_url(),
        CLOUD_DICTATION_WS_PATH,
    )
    .await
    .map_err(|error| format!("Cloud dictation route unavailable: {error}"))?;
    forge_voice_route_cache_store(CLOUD_DICTATION_WS_PATH, &ws_target, &auth_bearer);
    Ok((ws_target, auth_bearer))
}

async fn resolve_forge_voice_http_url(
    cloud_mcp_state: &CloudMcpState,
    endpoint_path: &str,
) -> Result<String, String> {
    cloud_mcp_wait_for_app_ws_auth(cloud_mcp_state)
        .await
        .map(|_| ())
        .map_err(|error| {
            format!("Diff Forge Cloud audio tools need the signed-in Diff Forge AI connection. {error}")
        })?;
    let ws_target = cloud_mcp_resolve_ws_target(
        cloud_mcp_state,
        &cloud_mcp_base_url(),
        endpoint_path,
    )
    .await
    .map_err(|error| format!("Cloud audio route unavailable: {error}"))?;
    let url = cloud_mcp_http_url_from_ws_url(&ws_target.ws_url)
        .ok_or_else(|| "Cloud audio direct route URL is invalid.".to_string())?;
    Ok(cloud_mcp_http_url_with_route_token(
        url,
        ws_target.route_token.as_deref(),
    ))
}

async fn forge_audio_cloud_http_headers(
    cloud_mcp_state: &CloudMcpState,
) -> Result<reqwest::header::HeaderMap, String> {
    let token = cloud_mcp_authorization_bearer(cloud_mcp_state)
        .await?
        .ok_or_else(|| {
            "Cloud auth token is unavailable; sign in before polishing transcripts.".to_string()
        })?;
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::AUTHORIZATION,
        reqwest::header::HeaderValue::from_str(&format!("Bearer {token}"))
            .map_err(|error| format!("Invalid cloud polish auth header: {error}"))?,
    );
    headers.insert(
        "x-diffforge-client-id",
        reqwest::header::HeaderValue::from_static(CLOUD_MCP_RUST_CLIENT_ID),
    );
    headers.insert(
        "x-diffforge-actor",
        reqwest::header::HeaderValue::from_static(CLOUD_MCP_RUST_CLIENT_ID),
    );

    let device_profile = cloud_mcp_desktop_device_profile();
    if let Some(device_id) = cloud_mcp_payload_text(&device_profile, &["device_id", "deviceId"]) {
        headers.insert(
            "x-diffforge-device-id",
            reqwest::header::HeaderValue::from_str(&device_id)
                .map_err(|error| format!("Invalid cloud polish device header: {error}"))?,
        );
    }

    let (billing_scope_type, team_id) = cloud_mcp_account_scope(cloud_mcp_state).await;
    headers.insert(
        "x-diffforge-billing-scope-type",
        reqwest::header::HeaderValue::from_str(&billing_scope_type)
            .map_err(|error| format!("Invalid cloud polish scope header: {error}"))?,
    );
    headers.insert(
        "x-diffforge-scope-type",
        reqwest::header::HeaderValue::from_str(&billing_scope_type)
            .map_err(|error| format!("Invalid cloud polish scope header: {error}"))?,
    );
    if let Some(team_id) = team_id {
        headers.insert(
            "x-diffforge-team-id",
            reqwest::header::HeaderValue::from_str(&team_id)
                .map_err(|error| format!("Invalid cloud polish team header: {error}"))?,
        );
    }

    let (plan_name, device_limit) = cloud_mcp_account_plan(cloud_mcp_state).await;
    headers.insert(
        "x-diffforge-plan-name",
        reqwest::header::HeaderValue::from_str(&plan_name)
            .map_err(|error| format!("Invalid cloud polish plan header: {error}"))?,
    );
    if let Some(device_limit) = device_limit {
        headers.insert(
            "x-diffforge-device-limit",
            reqwest::header::HeaderValue::from_str(&device_limit.to_string())
                .map_err(|error| format!("Invalid cloud polish device limit header: {error}"))?,
        );
    }

    Ok(headers)
}

#[tauri::command]
async fn polish_audio_transcription(
    app: AppHandle,
    cloud_mcp_state: State<'_, CloudMcpState>,
    request: AudioTranscriptionPolishRequest,
) -> Result<AudioTranscriptionPolishResult, String> {
    let source_text = audio_transcription_polish_source_text(request)?;
    let text = clean_deepgram_transcript_text(&source_text).map_err(|error| {
        if error.contains("did not produce any text") {
            "Clipboard does not contain text to polish.".to_string()
        } else {
            error
        }
    })?;
    let keyterms = voice_dictionary_bias_terms(&app);
    let url = resolve_forge_voice_http_url(cloud_mcp_state.inner(), CLOUD_DICTATION_POLISH_PATH)
        .await?;
    let headers = forge_audio_cloud_http_headers(cloud_mcp_state.inner()).await?;
    let payload = json!({
        "text": text,
        "keyterms": keyterms,
    });
    let response = http_client(Duration::from_secs(CLOUD_DICTATION_POLISH_TIMEOUT_SECS))?
        .post(url)
        .headers(headers)
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("Unable to polish transcript through Diff Forge Cloud: {error}"))?;
    let status = response.status();
    let body = response
        .json::<Value>()
        .await
        .map_err(|error| format!("Cloud polish response was invalid JSON: {error}"))?;
    if !status.is_success() {
        let message = body
            .pointer("/error/message")
            .or_else(|| body.get("error"))
            .and_then(Value::as_str)
            .unwrap_or("Cloud transcript polish failed.");
        return Err(format!("Cloud transcript polish failed ({status}): {message}"));
    }

    let data = body.get("data").unwrap_or(&body);
    let polished_text = data
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    if polished_text.is_empty() {
        return Err("Cloud transcript polish returned empty text.".to_string());
    }
    write_audio_transcription_polish_clipboard_text(&polished_text)?;

    Ok(AudioTranscriptionPolishResult {
        text: polished_text,
        raw_text: data
            .get("raw_text")
            .or_else(|| data.get("rawText"))
            .and_then(Value::as_str)
            .unwrap_or(&text)
            .trim()
            .to_string(),
        llm_cleaned: data
            .get("llm_cleaned")
            .or_else(|| data.get("llmCleaned"))
            .and_then(Value::as_bool)
            .unwrap_or(true),
        cleanup_ms: data
            .get("cleanup_ms")
            .or_else(|| data.get("cleanupMs"))
            .and_then(Value::as_u64)
            .unwrap_or(0),
        model: data
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string(),
    })
}

#[allow(clippy::too_many_arguments)]
async fn run_forge_dictation_stream(
    app: AppHandle,
    connection: ForgeDictationConnection,
    start_request: Value,
    history_id: String,
    history_created_at: String,
    mut audio_rx: mpsc::UnboundedReceiver<Vec<u8>>,
    mut control_rx: mpsc::UnboundedReceiver<ForgeDictationControl>,
    ready_tx: oneshot::Sender<Result<(), String>>,
    finished_tx: oneshot::Sender<Result<ForgeDictationResult, String>>,
) {
    let mut ready_tx = Some(ready_tx);
    let fail = |ready_tx: &mut Option<oneshot::Sender<Result<(), String>>>,
                finished_tx: oneshot::Sender<Result<ForgeDictationResult, String>>,
                message: String| {
        if let Some(ready_tx) = ready_tx.take() {
            let _ = ready_tx.send(Err(message.clone()));
        }
        let _ = finished_tx.send(Err(message));
    };

    let ws_stream = match connection {
        ForgeDictationConnection::Warm(stream) => stream,
        ForgeDictationConnection::Cold {
            ws_target,
            auth_bearer,
        } => {
            let request =
                match cloud_voice_agent_ws_request(&ws_target, auth_bearer.as_deref(), "", "") {
                    Ok(request) => request,
                    Err(error) => {
                        fail(&mut ready_tx, finished_tx, error);
                        return;
                    }
                };

            // Direct-only policy: the balancer never proxies websocket
            // traffic; a failed direct connect surfaces the error and the
            // caller retries with a freshly resolved route.
            match connect_async(request).await {
                Ok((stream, _)) => stream,
                Err(error) => {
                    fail(
                        &mut ready_tx,
                        finished_tx,
                        format!("Unable to open cloud dictation WebSocket: {error}"),
                    );
                    return;
                }
            }
        }
    };

    let (mut write, mut read) = ws_stream.split();
    if let Err(error) = write
        .send(Message::Text(start_request.to_string().into()))
        .await
    {
        fail(
            &mut ready_tx,
            finished_tx,
            format!("Unable to start cloud dictation stream: {error}"),
        );
        return;
    }

    // The start frame is on the wire, so report ready immediately instead of
    // blocking on the cloud credits gate and the Deepgram handshake. Audio is
    // forwarded right away and queues on the server socket until the stream
    // goes live, so no speech is lost; a start failure (for example missing
    // credits) surfaces as a "voice_dictation_error" through `finished_tx`.
    if let Some(ready_tx) = ready_tx.take() {
        let _ = ready_tx.send(Ok(()));
    }

    let mut audio_open = true;
    let mut control_open = true;
    let mut finish_sent = false;
    let mut cancel_requested = false;
    let mut started = false;
    let start_deadline = sleep(Duration::from_secs(CLOUD_DICTATION_START_TIMEOUT_SECS));
    tokio::pin!(start_deadline);
    let result: Result<ForgeDictationResult, String> = 'stream: loop {
        tokio::select! {
            _ = &mut start_deadline, if !started => {
                break Err("Cloud dictation timed out while starting the audio stream.".to_string());
            }
            maybe_control = control_rx.recv(), if control_open => {
                let (control_kind, cancel) = match maybe_control {
                    Some(ForgeDictationControl::Cancel) => ("cancel", true),
                    Some(ForgeDictationControl::Finish) => ("finish", false),
                    None => {
                        control_open = false;
                        continue;
                    }
                };
                cancel_requested = cancel_requested || cancel;
                if !finish_sent {
                    // Forward the captured tail before declaring the turn
                    // over: select! races this branch against the audio one,
                    // and the stop command detaches the mic before sending
                    // Finish, so frames still queued here are the end of the
                    // utterance — dropping them clipped trailing words.
                    if !cancel_requested {
                        let mut tail_frames: u64 = 0;
                        loop {
                            match audio_rx.try_recv() {
                                Ok(audio_bytes) => {
                                    if audio_bytes.is_empty() {
                                        continue;
                                    }
                                    tail_frames += 1;
                                    if let Err(error) = write.send(Message::Binary(audio_bytes.into())).await {
                                        break 'stream Err(format!("Unable to stream audio to Diff Forge Cloud: {error}"));
                                    }
                                }
                                Err(mpsc::error::TryRecvError::Empty) => break,
                                Err(mpsc::error::TryRecvError::Disconnected) => {
                                    audio_open = false;
                                    break;
                                }
                            }
                        }
                        if tail_frames > 0 {
                            log_audio_diagnostic_event(
                                "audio.forge_dictation.tail_flushed",
                                json!({ "frames": tail_frames }),
                            );
                        }
                    }
                    finish_sent = true;
                    let frame = json!({
                        "kind": control_kind,
                        "contract": CLOUD_DICTATION_CONTRACT,
                    });
                    if let Err(error) = write.send(Message::Text(frame.to_string().into())).await {
                        break Err(format!("Unable to finish cloud dictation: {error}"));
                    }
                }
            }
            maybe_audio = audio_rx.recv(), if audio_open => {
                match maybe_audio {
                    Some(audio_bytes) => {
                        if !audio_bytes.is_empty() && !finish_sent {
                            if let Err(error) = write.send(Message::Binary(audio_bytes.into())).await {
                                break Err(format!("Unable to stream audio to Diff Forge Cloud: {error}"));
                            }
                        }
                    }
                    None => {
                        audio_open = false;
                    }
                }
            }
            maybe_message = read.next() => {
                match maybe_message {
                    Some(Ok(Message::Ping(payload))) => {
                        let _ = write.send(Message::Pong(payload)).await;
                    }
                    Some(Ok(Message::Text(text))) => {
                        let Ok(payload) = serde_json::from_str::<Value>(text.as_str()) else {
                            continue;
                        };
                        match payload.get("kind").and_then(Value::as_str).unwrap_or_default() {
                            "voice_dictation_started" => {
                                started = true;
                            }
                            "voice_dictation_transcript" => {
                                started = true;
                                let transcript = payload
                                    .get("text")
                                    .and_then(Value::as_str)
                                    .unwrap_or_default()
                                    .trim()
                                    .to_string();
                                if !transcript.is_empty() {
                                    let is_final = payload
                                        .get("is_final")
                                        .and_then(Value::as_bool)
                                        .unwrap_or(false);
                                    let _ = app.emit(
                                        AUDIO_REALTIME_TRANSCRIPT_EVENT,
                                        DeepgramRealtimeTranscriptEvent {
                                            text: transcript,
                                            is_final,
                                            speech_final: is_final,
                                        },
                                    );
                                }
                            }
                            "voice_dictation_final" => {
                                log_audio_diagnostic_event(
                                    "audio.forge_dictation.final_received",
                                    json!({
                                        "cleanup_pending": payload.get("cleanup_pending"),
                                        "server_timings": payload.get("timings"),
                                    }),
                                );
                                let parsed =
                                    forge_dictation_result_from_payload(&payload, cancel_requested);
                                let cleanup_pending = payload
                                    .get("cleanup_pending")
                                    .and_then(Value::as_bool)
                                    .unwrap_or(false);
                                match parsed {
                                    Ok(mut result) if cleanup_pending => {
                                        if !result.cancelled && !result.raw_text.trim().is_empty() {
                                            let _ = app.emit(
                                                AUDIO_FORGE_DICTATION_RAW_RESULT_EVENT,
                                                ForgeDictationRawResultEvent {
                                                    history_id: history_id.clone(),
                                                    created_at: history_created_at.clone(),
                                                    text: result.raw_text.clone(),
                                                    raw_text: result.raw_text.clone(),
                                                    cleanup_pending,
                                                    llm_cleanup_requested: payload
                                                        .get("llm_cleanup_requested")
                                                        .and_then(Value::as_bool)
                                                        .unwrap_or(false),
                                                    audio_seconds: result.audio_seconds,
                                                },
                                            );
                                        }
                                        // Raw transcript is in hand; give the
                                        // cleaned follow-up frame a bounded
                                        // window, then return raw as-is.
                                        let cleaned_wait_started = Instant::now();
                                        let wait_cap = tokio::time::Instant::now()
                                            + Duration::from_secs(CLOUD_DICTATION_CLEANED_WAIT_CAP_SECS);
                                        let mut deadline = tokio::time::Instant::now()
                                            + Duration::from_secs(CLOUD_DICTATION_CLEANED_WAIT_SECS);
                                        loop {
                                            let remaining = deadline
                                                .min(wait_cap)
                                                .saturating_duration_since(tokio::time::Instant::now());
                                            if remaining.is_zero() {
                                                break;
                                            }
                                            match timeout(remaining, read.next()).await {
                                                Ok(Some(Ok(Message::Text(text)))) => {
                                                    let Ok(frame) =
                                                        serde_json::from_str::<Value>(text.as_str())
                                                    else {
                                                        continue;
                                                    };
                                                    let frame_kind = frame
                                                        .get("kind")
                                                        .and_then(Value::as_str)
                                                        .unwrap_or_default();
                                                    if frame_kind == "voice_dictation_cleanup_delta" {
                                                        // Streamed partial cleanup: surface it in
                                                        // the live overlay and keep waiting — the
                                                        // stream is alive, so extend the window.
                                                        let partial = frame
                                                            .get("text")
                                                            .and_then(Value::as_str)
                                                            .unwrap_or_default()
                                                            .trim()
                                                            .to_string();
                                                        if !partial.is_empty() {
                                                            let _ = app.emit(
                                                                AUDIO_REALTIME_TRANSCRIPT_EVENT,
                                                                DeepgramRealtimeTranscriptEvent {
                                                                    text: partial,
                                                                    is_final: false,
                                                                    speech_final: false,
                                                                },
                                                            );
                                                        }
                                                        deadline = tokio::time::Instant::now()
                                                            + Duration::from_secs(
                                                                CLOUD_DICTATION_CLEANED_PROGRESS_EXTEND_SECS,
                                                            );
                                                        continue;
                                                    }
                                                    if frame_kind != "voice_dictation_cleaned" {
                                                        continue;
                                                    }
                                                    let cleaned_text = frame
                                                        .get("text")
                                                        .and_then(Value::as_str)
                                                        .unwrap_or_default()
                                                        .trim()
                                                        .to_string();
                                                    if !cleaned_text.is_empty() {
                                                        result.text = cleaned_text;
                                                    }
                                                    result.llm_cleaned = frame
                                                        .get("llm_cleaned")
                                                        .and_then(Value::as_bool)
                                                        .unwrap_or(false);
                                                    log_audio_diagnostic_event(
                                                        "audio.forge_dictation.cleaned_received",
                                                        json!({
                                                            "wait_ms": cleaned_wait_started
                                                                .elapsed()
                                                                .as_millis() as u64,
                                                            "llm_cleaned": result.llm_cleaned,
                                                            "cleanup_ms": frame.get("cleanup_ms"),
                                                        }),
                                                    );
                                                    break;
                                                }
                                                Ok(Some(Ok(_))) => {}
                                                Ok(Some(Err(_))) | Ok(None) | Err(_) => break,
                                            }
                                        }
                                        break Ok(result);
                                    }
                                    other => break other,
                                }
                            }
                            "voice_dictation_error" => {
                                let message = payload
                                    .pointer("/error/message")
                                    .and_then(Value::as_str)
                                    .unwrap_or("Cloud dictation failed.")
                                    .to_string();
                                break Err(message);
                            }
                            _ => {}
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        break Err("Cloud dictation closed before returning a transcript.".to_string());
                    }
                    Some(Err(error)) => {
                        break Err(format!("Cloud dictation stream failed: {error}"));
                    }
                    _ => {}
                }
            }
        }
    };

    log_audio_diagnostic_event(
        "audio.forge_dictation.finished",
        json!({
            "ok": result.is_ok(),
            "cancelled": cancel_requested,
        }),
    );
    let _ = finished_tx.send(result);
}

/// Opens a fresh dictation websocket and waits for the cloud ready frame so a
/// claimed warm socket is known-good before press-to-talk relies on it.
async fn open_forge_dictation_warm_socket(
    cloud_mcp_state: &CloudMcpState,
) -> Result<ForgeDictationWsStream, String> {
    let (ws_target, auth_bearer) = resolve_forge_dictation_cloud_route(cloud_mcp_state).await?;
    let request = cloud_voice_agent_ws_request(&ws_target, auth_bearer.as_deref(), "", "")?;
    let (mut stream, _) = timeout(
        Duration::from_secs(CLOUD_DICTATION_WARM_CONNECT_TIMEOUT_SECS),
        connect_async(request),
    )
    .await
    .map_err(|_| "Warm cloud dictation connect timed out.".to_string())?
    .map_err(|error| format!("Unable to open the warm cloud dictation WebSocket: {error}"))?;

    let ready_deadline = sleep(Duration::from_secs(CLOUD_DICTATION_WARM_READY_TIMEOUT_SECS));
    tokio::pin!(ready_deadline);
    loop {
        tokio::select! {
            incoming = stream.next() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        let kind = serde_json::from_str::<Value>(text.as_str())
                            .ok()
                            .and_then(|payload| {
                                payload
                                    .get("kind")
                                    .and_then(Value::as_str)
                                    .map(str::to_string)
                            })
                            .unwrap_or_default();
                        if kind == "voice_dictation_ready" {
                            return Ok(stream);
                        }
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        if stream.send(Message::Pong(payload)).await.is_err() {
                            return Err("Warm cloud dictation socket closed during setup.".to_string());
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        return Err("Warm cloud dictation socket closed during setup.".to_string());
                    }
                    Some(Err(error)) => {
                        return Err(format!("Warm cloud dictation socket failed during setup: {error}"));
                    }
                    _ => {}
                }
            }
            _ = &mut ready_deadline => {
                return Err("Warm cloud dictation socket timed out waiting for ready.".to_string());
            }
        }
    }
}

enum ForgeDictationParkOutcome {
    Claimed(oneshot::Sender<Option<ForgeDictationWsStream>>),
    Released,
    Dead,
}

/// Parks a ready dictation socket in the warm slot and keeps it alive with
/// JSON pings until it is claimed by press-to-talk, released by a prewarm
/// disable/generation bump, or dies and needs a replacement.
async fn park_forge_dictation_warm_socket(
    audio_state: &AudioState,
    generation: u64,
    mut stream: ForgeDictationWsStream,
) {
    let (claim_tx, mut claim_rx) =
        oneshot::channel::<oneshot::Sender<Option<ForgeDictationWsStream>>>();
    {
        let mut slot_guard = audio_state.forge_dictation_warm.lock().await;
        if !audio_state.forge_dictation_warm_desired.load(Ordering::SeqCst)
            || audio_state.forge_dictation_warm_generation.load(Ordering::SeqCst) != generation
        {
            drop(slot_guard);
            let _ = stream.close(None).await;
            return;
        }
        *slot_guard = Some(ForgeDictationWarmSlot { claim_tx });
    }
    log_audio_diagnostic_event("audio.forge_dictation.warm.parked", json!({}));

    let mut ping_interval =
        tokio::time::interval(Duration::from_secs(CLOUD_DICTATION_WARM_PING_SECS));
    ping_interval.tick().await;
    let outcome = loop {
        tokio::select! {
            claim = &mut claim_rx => {
                match claim {
                    Ok(reply_tx) => break ForgeDictationParkOutcome::Claimed(reply_tx),
                    Err(_) => break ForgeDictationParkOutcome::Released,
                }
            }
            _ = ping_interval.tick() => {
                let ping = json!({
                    "kind": "ping",
                    "contract": CLOUD_DICTATION_CONTRACT,
                });
                if stream.send(Message::Text(ping.to_string().into())).await.is_err() {
                    break ForgeDictationParkOutcome::Dead;
                }
            }
            incoming = stream.next() => {
                match incoming {
                    Some(Ok(Message::Ping(payload))) => {
                        if stream.send(Message::Pong(payload)).await.is_err() {
                            break ForgeDictationParkOutcome::Dead;
                        }
                    }
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => {
                        break ForgeDictationParkOutcome::Dead;
                    }
                    _ => {}
                }
            }
        }
    };

    match outcome {
        ForgeDictationParkOutcome::Claimed(reply_tx) => {
            log_audio_diagnostic_event("audio.forge_dictation.warm.claimed", json!({}));
            let _ = reply_tx.send(Some(stream));
        }
        ForgeDictationParkOutcome::Released => {
            let _ = stream.close(None).await;
        }
        ForgeDictationParkOutcome::Dead => {
            log_audio_diagnostic_event("audio.forge_dictation.warm.died", json!({}));
            // Only this keeper installs slots for its generation, so taking
            // the slot here cannot remove another keeper's socket.
            audio_state.forge_dictation_warm.lock().await.take();
            let _ = stream.close(None).await;
        }
    }
}

/// Background keeper: while warm dictation stays desired for this generation,
/// keep one ready socket parked at all times, replacing it immediately after
/// it is claimed or dies (with backoff while the cloud is unreachable).
fn spawn_forge_dictation_warm_loop(app: AppHandle, generation: u64) {
    tauri::async_runtime::spawn(async move {
        let audio_state = app.state::<AudioState>().inner().clone();
        let cloud_mcp_state = app.state::<CloudMcpState>().inner().clone();
        let mut retry_delay_ms = CLOUD_DICTATION_WARM_RETRY_MIN_MS;
        loop {
            if !audio_state.forge_dictation_warm_desired.load(Ordering::SeqCst)
                || audio_state.forge_dictation_warm_generation.load(Ordering::SeqCst) != generation
            {
                return;
            }
            match open_forge_dictation_warm_socket(&cloud_mcp_state).await {
                Ok(stream) => {
                    retry_delay_ms = CLOUD_DICTATION_WARM_RETRY_MIN_MS;
                    park_forge_dictation_warm_socket(&audio_state, generation, stream).await;
                }
                Err(error) => {
                    log_audio_diagnostic_event(
                        "audio.forge_dictation.warm.connect_error",
                        json!({ "error": error }),
                    );
                    sleep(Duration::from_millis(retry_delay_ms)).await;
                    retry_delay_ms = (retry_delay_ms * 2).min(CLOUD_DICTATION_WARM_RETRY_MAX_MS);
                }
            }
        }
    });
}

/// Claims the parked warm socket, if one is ready right now.
async fn claim_forge_dictation_warm_stream(
    audio_state: &AudioState,
) -> Option<ForgeDictationWsStream> {
    let slot = audio_state.forge_dictation_warm.lock().await.take()?;
    let (reply_tx, reply_rx) = oneshot::channel();
    if slot.claim_tx.send(reply_tx).is_err() {
        return None;
    }
    match timeout(
        Duration::from_millis(CLOUD_DICTATION_WARM_CLAIM_TIMEOUT_MS),
        reply_rx,
    )
    .await
    {
        Ok(Ok(stream)) => stream,
        _ => None,
    }
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct ForgeDictationPrewarmRequest {
    enabled: Option<bool>,
}

#[tauri::command]
async fn prewarm_forge_dictation_transcription(
    app: AppHandle,
    audio_state: State<'_, AudioState>,
    request: Option<ForgeDictationPrewarmRequest>,
) -> Result<bool, String> {
    let enabled = request.and_then(|request| request.enabled).unwrap_or(true);
    log_audio_diagnostic_event(
        "audio.forge_dictation.prewarm.command",
        json!({ "enabled": enabled }),
    );

    if !enabled {
        audio_state
            .forge_dictation_warm_desired
            .store(false, Ordering::SeqCst);
        audio_state
            .forge_dictation_warm_generation
            .fetch_add(1, Ordering::SeqCst);
        audio_state.forge_dictation_warm.lock().await.take();
        return Ok(false);
    }

    if audio_state
        .forge_dictation_warm_desired
        .swap(true, Ordering::SeqCst)
    {
        // A keeper loop is already maintaining the warm connection.
        return Ok(true);
    }

    let generation = audio_state
        .forge_dictation_warm_generation
        .fetch_add(1, Ordering::SeqCst)
        + 1;
    spawn_forge_dictation_warm_loop(app, generation);
    Ok(true)
}

#[tauri::command]
async fn start_forge_dictation_transcription(
    app: AppHandle,
    audio_state: State<'_, AudioState>,
    cloud_mcp_state: State<'_, CloudMcpState>,
    request: ForgeDictationStartRequest,
) -> Result<ForgeDictationStartStatus, String> {
    let command_started_at = Instant::now();
    let llm_cleanup = request.llm_cleanup.unwrap_or(true);
    let language = clean_deepgram_language(request.language)?;
    let history_id = request
        .history_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(128).collect::<String>())
        .unwrap_or_else(|| format!("forge-dictation-{}", uuid::Uuid::new_v4()));
    let history_created_at = request
        .history_created_at
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("")
        .chars()
        .take(64)
        .collect::<String>();
    log_audio_diagnostic_event(
        "audio.forge_dictation.start.command",
        json!({
            "language": language.clone(),
            "llm_cleanup": llm_cleanup,
        }),
    );
    let _realtime_guard = audio_state.realtime_stream_lock.lock().await;
    let mut session_guard = audio_state.forge_dictation_stream.lock().await;

    if let Some(session) = session_guard.as_mut() {
        // Reap a dictation session that ended without a stop command (for
        // example a dropped websocket) instead of refusing the new start.
        match session.finished_rx.try_recv() {
            Ok(_) | Err(tokio::sync::oneshot::error::TryRecvError::Closed) => {
                *session_guard = None;
                let _ = realtime_mic_detach_for(&audio_state, RealtimeMicHolder::Dictation);
            }
            Err(tokio::sync::oneshot::error::TryRecvError::Empty) => {}
        }
    }
    if session_guard.is_some() {
        return Err("Diff Forge Cloud dictation is already active.".to_string());
    }
    {
        let mut deepgram_guard = audio_state.deepgram_stream.lock().await;
        if let Some(session) = deepgram_guard.as_mut() {
            // Same reap rule for a stale own-key Deepgram session (provider
            // switch mid-take, dropped websocket).
            match session.finished_rx.try_recv() {
                Ok(_) | Err(tokio::sync::oneshot::error::TryRecvError::Closed) => {
                    *deepgram_guard = None;
                    let _ = realtime_mic_detach_for(&audio_state, RealtimeMicHolder::Deepgram);
                }
                Err(tokio::sync::oneshot::error::TryRecvError::Empty) => {}
            }
        }
        if deepgram_guard.is_some() {
            return Err("Deepgram realtime transcription is already active.".to_string());
        }
    }

    // Mic arbitration: a live voice agent session no longer blocks dictation.
    // Dictation borrows the microphone (attaching below replaces the agent's
    // feed, which to the cloud session is indistinguishable from silence) and
    // teardown hands it back. A session that already released its input
    // (manual finish) or has finished is not a lender.
    let mut borrowed_from_voice_agent = false;
    {
        let mut agent_guard = audio_state.cloud_voice_agent_stream.lock().await;
        if let Some(agent) = agent_guard.as_mut() {
            match agent.finished_rx.try_recv() {
                Ok(_) | Err(tokio::sync::oneshot::error::TryRecvError::Closed) => {
                    *agent_guard = None;
                    let _ = realtime_mic_detach_for(&audio_state, RealtimeMicHolder::VoiceAgent);
                }
                Err(tokio::sync::oneshot::error::TryRecvError::Empty) => {
                    if realtime_mic_holder_get(&audio_state) == RealtimeMicHolder::VoiceAgent {
                        borrowed_from_voice_agent = true;
                    }
                }
            }
        }
    }

    // Attach the microphone before any network work: captured audio buffers
    // in the unbounded channel from this moment, so even a cold connect loses
    // none of the user's speech.
    let (audio_tx, audio_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let status = audio_state.input_worker.attach_realtime_stream(audio_tx)?;
    realtime_mic_holder_set(&audio_state, RealtimeMicHolder::Dictation);
    audio_state
        .forge_dictation_mic_borrowed
        .store(borrowed_from_voice_agent, Ordering::SeqCst);
    if borrowed_from_voice_agent {
        emit_voice_agent_mic_event(&app, "paused", "dictation_started");
        log_audio_diagnostic_event("audio.cloud_voice.mic.paused", json!({}));
    }

    // Prefer the parked warm websocket (already authenticated and ready on
    // the cloud side); fall back to a cold connect when none is available.
    let warm_stream = claim_forge_dictation_warm_stream(&audio_state).await;
    let used_warm_socket = warm_stream.is_some();
    // Cold path: a freshly cached route (usually the warm keeper's, seconds
    // old) skips the serial auth + heartbeat + balancer round trips.
    let connection = match warm_stream {
        Some(stream) => ForgeDictationConnection::Warm(stream),
        None => match forge_voice_route_cache_fresh(CLOUD_DICTATION_WS_PATH) {
            Some((ws_target, auth_bearer)) => {
                log_audio_diagnostic_event("audio.forge_dictation.route.cached", json!({}));
                ForgeDictationConnection::Cold {
                    ws_target,
                    auth_bearer,
                }
            }
            None => match resolve_forge_dictation_cloud_route(cloud_mcp_state.inner()).await {
                Ok((ws_target, auth_bearer)) => ForgeDictationConnection::Cold {
                    ws_target,
                    auth_bearer,
                },
                Err(error) => {
                    forge_dictation_release_mic(&app, &audio_state).await;
                    return Err(error);
                }
            },
        },
    };

    let (control_tx, control_rx) = mpsc::unbounded_channel::<ForgeDictationControl>();
    let (ready_tx, ready_rx) = oneshot::channel();
    let (finished_tx, finished_rx) = oneshot::channel();
    // The run task takes `app`; keep a handle for mic release on failure.
    let app_handle = app.clone();

    // Dictionary phrases ride the start frame so the cloud passes them to
    // Deepgram as keyterm prompts: recognition itself prefers the user's
    // vocabulary instead of leaning on post-hoc text correction alone.
    let keyterms = voice_dictionary_bias_terms(&app);
    let keyterm_count = keyterms.len();
    let start_request = json!({
        "kind": "start",
        "contract": CLOUD_DICTATION_CONTRACT,
        "voice_session_id": format!("dictation-{}", uuid::Uuid::new_v4()),
        "sample_rate": status.sample_rate,
        "language": language.clone(),
        "llm_cleanup": llm_cleanup,
        // Raw-first finalization: final raw transcript immediately after the
        // Deepgram flush, cleaned text as a follow-up frame.
        "raw_first": true,
        "keyterms": keyterms,
    });

    tauri::async_runtime::spawn(run_forge_dictation_stream(
        app,
        connection,
        start_request,
        history_id,
        history_created_at,
        audio_rx,
        control_rx,
        ready_tx,
        finished_tx,
    ));

    match timeout(Duration::from_secs(CLOUD_DICTATION_START_TIMEOUT_SECS), ready_rx).await {
        Ok(Ok(Ok(()))) => {}
        Ok(Ok(Err(error))) => {
            forge_dictation_release_mic(&app_handle, &audio_state).await;
            return Err(error);
        }
        Ok(Err(_closed)) => {
            forge_dictation_release_mic(&app_handle, &audio_state).await;
            return Err("Cloud dictation closed before it was ready.".to_string());
        }
        Err(_elapsed) => {
            forge_dictation_release_mic(&app_handle, &audio_state).await;
            return Err("Cloud dictation timed out while connecting.".to_string());
        }
    }

    *session_guard = Some(ForgeDictationSession {
        control_tx,
        finished_rx,
    });

    log_audio_diagnostic_event(
        "audio.forge_dictation.start.done",
        json!({
            "language": language.clone(),
            "sample_rate": status.sample_rate,
            "llm_cleanup": llm_cleanup,
            "keyterms": keyterm_count,
            "warm_socket": used_warm_socket,
            "elapsed_ms": command_started_at.elapsed().as_millis() as u64,
        }),
    );

    Ok(ForgeDictationStartStatus {
        active: true,
        language,
        model: "nova-3".to_string(),
        sample_rate: status.sample_rate,
        llm_cleanup,
    })
}

#[tauri::command]
async fn stop_forge_dictation_transcription(
    app: AppHandle,
    audio_state: State<'_, AudioState>,
    request: Option<ForgeDictationStopRequest>,
) -> Result<ForgeDictationResult, String> {
    let stop_started_at = Instant::now();
    let cancel = request.map(|request| request.cancel).unwrap_or(false);
    log_audio_diagnostic_event(
        "audio.forge_dictation.stop.command",
        json!({
            "cancel": cancel,
        }),
    );
    let _realtime_guard = audio_state.realtime_stream_lock.lock().await;
    let session = {
        let mut session_guard = audio_state.forge_dictation_stream.lock().await;
        session_guard.take()
    };
    let Some(session) = session else {
        log_audio_diagnostic_event("audio.forge_dictation.stop.inactive", json!({}));
        return Ok(ForgeDictationResult {
            text: String::new(),
            raw_text: String::new(),
            cancelled: cancel,
            llm_cleaned: false,
            audio_seconds: 0,
        });
    };

    // Detach the mic BEFORE sending the finish control: detaching stops the
    // capture thread and flushes its last frames into the audio channel, so
    // when the stream task processes Finish, everything still queued IS the
    // complete tail of the utterance. The other order raced the capture
    // thread and clipped trailing words ("hey there can you hear me" losing
    // everything after "can"). Release also hands the mic back to a voice
    // agent session that lent it (mic arbitration); plain dictation just
    // detaches.
    forge_dictation_release_mic(&app, &audio_state).await;
    let _ = session.control_tx.send(if cancel {
        ForgeDictationControl::Cancel
    } else {
        ForgeDictationControl::Finish
    });

    let result = timeout(
        Duration::from_secs(CLOUD_DICTATION_RESULT_TIMEOUT_SECS),
        session.finished_rx,
    )
    .await
    .map_err(|_| "Cloud dictation timed out while finishing.".to_string())?
    .map_err(|_| "Cloud dictation stopped before returning a transcript.".to_string())??;

    log_audio_diagnostic_event(
        "audio.forge_dictation.stop.done",
        json!({
            "text_chars": result.text.chars().count(),
            "cancelled": result.cancelled,
            "llm_cleaned": result.llm_cleaned,
            "elapsed_ms": stop_started_at.elapsed().as_millis() as u64,
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
async fn audio_widget_bar_hover_snapshot(
    app: AppHandle,
    request: AudioWidgetBarHoverSnapshotRequest,
) -> Result<AudioWidgetBarHoverSnapshot, String> {
    Ok(audio_widget_bar_hover_snapshot_for(&app, &request))
}

#[tauri::command]
async fn audio_widget_bar_anchor_strategy(
    app: AppHandle,
) -> Result<AudioWidgetBarAnchorStrategy, String> {
    audio_widget_bar_anchor_strategy_for(&app)
}

#[tauri::command]
async fn audio_widget_release_keyboard_focus(app: AppHandle) -> Result<bool, String> {
    audio_widget_release_keyboard_focus_on_main_thread(&app)
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

    #[cfg(target_os = "macos")]
    let _ = audio_widget_release_keyboard_focus_on_main_thread(&app);

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

const HYPERFRAME_TRANSCRIBE_MAX_WAV_BYTES: usize = 96 * 1024 * 1024;
const HYPERFRAME_DEEPGRAM_TIMEOUT_SECS: u64 = 600;
const HYPERFRAME_WHISPER_FILE_TIMEOUT_SECS: u64 = 1_800;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HyperframeTranscribeRequest {
    provider: String,
    api_key: Option<String>,
    language: Option<String>,
    audio_base64: String,
}

fn hyperframe_transcript_language(language: Option<String>) -> String {
    let cleaned = language.unwrap_or_default().trim().to_lowercase();
    if cleaned.is_empty()
        || !cleaned
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
        || cleaned.len() > 12
    {
        "en".to_string()
    } else {
        cleaned
    }
}

fn hyperframe_transcript_number(value: &Value) -> f64 {
    value.as_f64().unwrap_or(0.0).max(0.0)
}

async fn hyperframe_transcribe_with_deepgram(
    api_key: String,
    language: String,
    audio_bytes: Vec<u8>,
) -> Result<Value, String> {
    let url = format!(
        "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true&utterances=true&language={language}"
    );
    let client = http_client(Duration::from_secs(HYPERFRAME_DEEPGRAM_TIMEOUT_SECS))?;
    let response = client
        .post(url)
        .header("Authorization", format!("Token {api_key}"))
        .header("Content-Type", "audio/wav")
        .body(audio_bytes)
        .send()
        .await
        .map_err(|error| format!("Deepgram transcription request failed: {error}"))?;
    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|error| format!("Deepgram returned an unreadable response: {error}"))?;
    if !status.is_success() {
        let message = body
            .get("err_msg")
            .and_then(Value::as_str)
            .or_else(|| body.get("error").and_then(Value::as_str))
            .unwrap_or("Deepgram rejected the transcription request.");
        return Err(format!("Deepgram error ({status}): {message}"));
    }

    let utterances = body
        .pointer("/results/utterances")
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| {
                    let text = entry.get("transcript").and_then(Value::as_str)?.trim();
                    if text.is_empty() {
                        return None;
                    }
                    Some(json!({
                        "end": hyperframe_transcript_number(entry.get("end").unwrap_or(&Value::Null)),
                        "start": hyperframe_transcript_number(entry.get("start").unwrap_or(&Value::Null)),
                        "text": text,
                    }))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let words = body
        .pointer("/results/channels/0/alternatives/0/words")
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| {
                    let text = entry
                        .get("punctuated_word")
                        .and_then(Value::as_str)
                        .or_else(|| entry.get("word").and_then(Value::as_str))?
                        .trim();
                    if text.is_empty() {
                        return None;
                    }
                    Some(json!({
                        "end": hyperframe_transcript_number(entry.get("end").unwrap_or(&Value::Null)),
                        "start": hyperframe_transcript_number(entry.get("start").unwrap_or(&Value::Null)),
                        "text": text,
                    }))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let fallback_transcript = body
        .pointer("/results/channels/0/alternatives/0/transcript")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    let duration_seconds =
        hyperframe_transcript_number(body.pointer("/metadata/duration").unwrap_or(&Value::Null));

    let utterances = if utterances.is_empty() && !fallback_transcript.is_empty() {
        vec![json!({
            "end": duration_seconds,
            "start": 0.0,
            "text": fallback_transcript,
        })]
    } else {
        utterances
    };
    if utterances.is_empty() {
        return Err("Deepgram returned no transcript for this audio.".to_string());
    }

    Ok(json!({
        "durationSeconds": duration_seconds,
        "language": language,
        "tool": "deepgram",
        "utterances": utterances,
        "words": words,
    }))
}

fn hyperframe_transcribe_with_whisper(
    runtime_path: PathBuf,
    model_path: PathBuf,
    recordings_directory: PathBuf,
    language: String,
    audio_bytes: Vec<u8>,
) -> Result<Value, String> {
    fs::create_dir_all(&recordings_directory)
        .map_err(|error| format!("Unable to prepare transcription directory: {error}"))?;
    let job_id = current_time_ms();
    let audio_path = recordings_directory.join(format!("hyperframe-{job_id}.wav"));
    let output_base = recordings_directory.join(format!("hyperframe-{job_id}"));
    fs::write(&audio_path, &audio_bytes)
        .map_err(|error| format!("Unable to prepare transcription audio: {error}"))?;

    let runtime = runtime_path.display().to_string();
    let model = model_path.display().to_string();
    let audio = audio_path.display().to_string();
    let output = output_base.display().to_string();
    let threads = whisper_cli_thread_count().to_string();
    let args = [
        "-m", model.as_str(),
        "-f", audio.as_str(),
        "-l", language.as_str(),
        "-t", threads.as_str(),
        "-np",
        "-oj",
        "-of", output.as_str(),
    ];
    let capture = run_command_capture(
        &runtime,
        &args,
        None,
        Duration::from_secs(HYPERFRAME_WHISPER_FILE_TIMEOUT_SECS),
        None,
    );
    let json_path = output_base.with_extension("json");
    let parse_result = capture.and_then(|capture| {
        if capture.exit_code != Some(0) {
            return Err(format!(
                "Local Whisper transcription failed: {}",
                command_output_text(&capture.stdout, &capture.stderr)
            ));
        }
        let body = fs::read_to_string(&json_path)
            .map_err(|error| format!("Unable to read Whisper transcript output: {error}"))?;
        let parsed: Value = serde_json::from_str(&body)
            .map_err(|error| format!("Whisper transcript output is invalid: {error}"))?;
        let utterances = parsed
            .get("transcription")
            .and_then(Value::as_array)
            .map(|entries| {
                entries
                    .iter()
                    .filter_map(|entry| {
                        let text = entry.get("text").and_then(Value::as_str)?.trim();
                        if text.is_empty() {
                            return None;
                        }
                        let from_ms =
                            hyperframe_transcript_number(entry.pointer("/offsets/from").unwrap_or(&Value::Null));
                        let to_ms =
                            hyperframe_transcript_number(entry.pointer("/offsets/to").unwrap_or(&Value::Null));
                        Some(json!({
                            "end": to_ms / 1000.0,
                            "start": from_ms / 1000.0,
                            "text": text,
                        }))
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        if utterances.is_empty() {
            return Err("Local Whisper returned no transcript for this audio.".to_string());
        }
        let duration_seconds = utterances
            .iter()
            .map(|entry| hyperframe_transcript_number(entry.get("end").unwrap_or(&Value::Null)))
            .fold(0.0f64, f64::max);
        Ok(json!({
            "durationSeconds": duration_seconds,
            "language": language,
            "tool": "whisper-local",
            "utterances": utterances,
            "words": [],
        }))
    });
    let _ = fs::remove_file(&audio_path);
    let _ = fs::remove_file(&json_path);
    parse_result
}

#[tauri::command]
async fn hyperframe_transcribe_audio(
    app: AppHandle,
    request: HyperframeTranscribeRequest,
) -> Result<Value, String> {
    let provider = request.provider.trim().to_lowercase();
    let language = hyperframe_transcript_language(request.language.clone());
    if request.audio_base64.len() > HYPERFRAME_TRANSCRIBE_MAX_WAV_BYTES * 2 {
        return Err("The extracted audio is too large to transcribe in one pass.".to_string());
    }
    let audio_bytes = general_purpose::STANDARD
        .decode(request.audio_base64.trim())
        .map_err(|error| format!("Extracted audio is not valid base64: {error}"))?;
    if audio_bytes.len() > HYPERFRAME_TRANSCRIBE_MAX_WAV_BYTES {
        return Err("The extracted audio is too large to transcribe in one pass.".to_string());
    }
    if audio_bytes.is_empty() {
        return Err("No audio could be extracted from this media file.".to_string());
    }

    if provider == "deepgram" {
        let api_key = clean_deepgram_api_key(request.api_key.as_deref().unwrap_or(""))?;
        return hyperframe_transcribe_with_deepgram(api_key, language, audio_bytes).await;
    }

    let model_path = whisper_model_path(&app)?;
    if !model_path.exists() {
        return Err("Install the local Whisper model from the Audio tab first.".to_string());
    }
    let runtime_path = whisper_runtime_executable_path(&app)?
        .ok_or_else(|| "Install the local Whisper runtime from the Audio tab first.".to_string())?;
    let recordings_directory = whisper_model_directory(&app)?.join("recordings");
    tauri::async_runtime::spawn_blocking(move || {
        hyperframe_transcribe_with_whisper(
            runtime_path,
            model_path,
            recordings_directory,
            language,
            audio_bytes,
        )
    })
    .await
    .map_err(|error| format!("Local Whisper transcription task failed: {error}"))?
}

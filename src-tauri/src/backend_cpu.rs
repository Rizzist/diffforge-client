const BACKEND_CPU_ATTRIBUTION_ENABLED: bool = true;
const BACKEND_CPU_ATTRIBUTION_DUMP_ENABLED: bool = true;
const BACKEND_CPU_ATTRIBUTION_DUMP_INTERVAL_MS: u64 = 5_000;
const BACKEND_CPU_ATTRIBUTION_FILE_NAME: &str = "diffforge-backend-cpu-attribution.json";
const BACKEND_HEAVY_JOB_PERMITS: usize = 2;

#[derive(Clone, Default)]
struct BackendCpuAttributionMetric {
    count: u64,
    wall_total_ns: u128,
    cpu_total_ns: u128,
    window_cpu_ns: u128,
    window_count: u64,
    cpu_sample_count: u64,
    wall_max_ns: u128,
    cpu_max_ns: u128,
    wall_last_ns: u128,
    cpu_last_ns: Option<u128>,
    last_finished_ms: u64,
}

struct BackendCpuAttributionState {
    started_at_ms: u64,
    last_dump_ms: u64,
    metrics: HashMap<&'static str, BackendCpuAttributionMetric>,
}

impl BackendCpuAttributionState {
    fn new(now_ms: u64) -> Self {
        Self {
            started_at_ms: now_ms,
            last_dump_ms: 0,
            metrics: HashMap::new(),
        }
    }
}

struct BackendCpuSpan {
    tag: &'static str,
    wall_started: Instant,
    cpu_started_ns: Option<u128>,
    thread_id: std::thread::ThreadId,
}

impl BackendCpuSpan {
    fn new(tag: &'static str) -> Self {
        let cpu_started_ns = if backend_cpu_attribution_enabled() {
            backend_thread_cpu_time_ns()
        } else {
            None
        };
        Self {
            tag,
            wall_started: Instant::now(),
            cpu_started_ns,
            thread_id: std::thread::current().id(),
        }
    }
}

impl Drop for BackendCpuSpan {
    fn drop(&mut self) {
        if !backend_cpu_attribution_enabled() {
            return;
        }
        let wall_ns = self.wall_started.elapsed().as_nanos();
        let cpu_ns = if self.thread_id == std::thread::current().id() {
            self.cpu_started_ns.and_then(|started| {
                backend_thread_cpu_time_ns().map(|finished| finished.saturating_sub(started))
            })
        } else {
            None
        };
        backend_cpu_attribution_record(self.tag, wall_ns, cpu_ns);
    }
}

static BACKEND_CPU_ATTRIBUTION_STATE: OnceLock<StdMutex<BackendCpuAttributionState>> =
    OnceLock::new();
static BACKEND_CPU_ATTRIBUTION_ENV_ENABLED: OnceLock<bool> = OnceLock::new();
static BACKEND_HEAVY_JOB_SEMAPHORE: OnceLock<BackendHeavyJobSemaphore> = OnceLock::new();

thread_local! {
    static BACKEND_HEAVY_JOB_DEPTH: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

struct BackendHeavyJobSemaphore {
    permits: StdMutex<usize>,
    available: std::sync::Condvar,
}

impl BackendHeavyJobSemaphore {
    fn new() -> Self {
        Self {
            permits: StdMutex::new(BACKEND_HEAVY_JOB_PERMITS),
            available: std::sync::Condvar::new(),
        }
    }
}

struct BackendHeavyJobPermit {
    acquired: bool,
    _tag: &'static str,
}

fn backend_heavy_job_semaphore() -> &'static BackendHeavyJobSemaphore {
    BACKEND_HEAVY_JOB_SEMAPHORE.get_or_init(BackendHeavyJobSemaphore::new)
}

fn backend_heavy_job_acquire(tag: &'static str) -> BackendHeavyJobPermit {
    let nested = BACKEND_HEAVY_JOB_DEPTH.with(|depth| {
        let current = depth.get();
        depth.set(current.saturating_add(1));
        current > 0
    });
    if nested {
        return BackendHeavyJobPermit {
            acquired: false,
            _tag: tag,
        };
    }

    let _span = BackendCpuSpan::new("backend.heavy_job.wait");
    let semaphore = backend_heavy_job_semaphore();
    let mut permits = match semaphore.permits.lock() {
        Ok(permits) => permits,
        Err(error) => error.into_inner(),
    };
    while *permits == 0 {
        permits = match semaphore.available.wait(permits) {
            Ok(permits) => permits,
            Err(error) => error.into_inner(),
        };
    }
    *permits = permits.saturating_sub(1);
    drop(permits);
    BackendHeavyJobPermit {
        acquired: true,
        _tag: tag,
    }
}

impl Drop for BackendHeavyJobPermit {
    fn drop(&mut self) {
        BACKEND_HEAVY_JOB_DEPTH.with(|depth| {
            let current = depth.get();
            depth.set(current.saturating_sub(1));
        });
        if !self.acquired {
            return;
        }
        let semaphore = backend_heavy_job_semaphore();
        let mut permits = match semaphore.permits.lock() {
            Ok(permits) => permits,
            Err(error) => error.into_inner(),
        };
        *permits = (*permits).saturating_add(1).min(BACKEND_HEAVY_JOB_PERMITS);
        semaphore.available.notify_one();
    }
}

fn backend_cpu_env_truthy(name: &str) -> bool {
    env::var(name)
        .map(|value| {
            let value = value.trim().to_ascii_lowercase();
            !matches!(value.as_str(), "" | "0" | "false" | "off" | "no")
        })
        .unwrap_or(false)
}

fn backend_cpu_attribution_env_enabled() -> bool {
    if !BACKEND_CPU_ATTRIBUTION_ENABLED {
        return false;
    }
    // Default OFF: this instrumentation does a pair of Mach thread_info syscalls on
    // every instrumented span and writes a JSON snapshot to disk every 5s, so it must
    // not run in normal use. Re-enable on demand with DIFFFORGE_BACKEND_CPU_ATTRIBUTION=1.
    *BACKEND_CPU_ATTRIBUTION_ENV_ENABLED
        .get_or_init(|| backend_cpu_env_truthy("DIFFFORGE_BACKEND_CPU_ATTRIBUTION"))
}

pub(crate) fn backend_cpu_attribution_enabled() -> bool {
    if !BACKEND_CPU_ATTRIBUTION_ENABLED {
        return false;
    }

    backend_cpu_attribution_env_enabled() || energy_impact::energy_impact_enabled()
}

fn backend_cpu_attribution_dump_enabled() -> bool {
    BACKEND_CPU_ATTRIBUTION_DUMP_ENABLED && backend_cpu_attribution_env_enabled()
}

fn backend_cpu_attribution_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

#[cfg(target_os = "linux")]
fn backend_thread_cpu_time_ns() -> Option<u128> {
    let mut usage = std::mem::MaybeUninit::<libc::rusage>::uninit();
    let result = unsafe { libc::getrusage(libc::RUSAGE_THREAD, usage.as_mut_ptr()) };
    if result != 0 {
        return None;
    }

    let usage = unsafe { usage.assume_init() };
    let user_ns = (usage.ru_utime.tv_sec as i128)
        .saturating_mul(1_000_000_000)
        .saturating_add((usage.ru_utime.tv_usec as i128).saturating_mul(1_000));
    let system_ns = (usage.ru_stime.tv_sec as i128)
        .saturating_mul(1_000_000_000)
        .saturating_add((usage.ru_stime.tv_usec as i128).saturating_mul(1_000));
    let total = user_ns.saturating_add(system_ns);
    (total >= 0).then_some(total as u128)
}

#[cfg(target_os = "macos")]
extern "C" {
    fn mach_port_deallocate(
        task: libc::mach_port_t,
        name: libc::mach_port_t,
    ) -> libc::kern_return_t;
}

#[cfg(target_os = "macos")]
fn backend_thread_cpu_time_ns() -> Option<u128> {
    let thread = unsafe { libc::mach_thread_self() };
    if thread == 0 {
        return None;
    }

    let mut info = std::mem::MaybeUninit::<libc::thread_basic_info_data_t>::uninit();
    let mut count = libc::THREAD_BASIC_INFO_COUNT;
    let result = unsafe {
        libc::thread_info(
            thread,
            libc::THREAD_BASIC_INFO as libc::thread_flavor_t,
            info.as_mut_ptr() as libc::thread_info_t,
            &mut count,
        )
    };
    let _ = unsafe { mach_port_deallocate(libc::mach_task_self(), thread) };
    if result != libc::KERN_SUCCESS {
        return None;
    }

    let info = unsafe { info.assume_init() };
    let time_value_ns = |time: libc::time_value_t| {
        (time.seconds as i128)
            .saturating_mul(1_000_000_000)
            .saturating_add((time.microseconds as i128).saturating_mul(1_000))
    };
    let total = time_value_ns(info.user_time).saturating_add(time_value_ns(info.system_time));
    (total >= 0).then_some(total as u128)
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn backend_thread_cpu_time_ns() -> Option<u128> {
    None
}

fn backend_cpu_attribution_record(tag: &'static str, wall_ns: u128, cpu_ns: Option<u128>) {
    let now_ms = backend_cpu_attribution_now_ms();
    let state = BACKEND_CPU_ATTRIBUTION_STATE
        .get_or_init(|| StdMutex::new(BackendCpuAttributionState::new(now_ms)));
    let should_dump = {
        let Ok(mut state) = state.lock() else {
            return;
        };
        let metric = state.metrics.entry(tag).or_default();
        metric.count = metric.count.saturating_add(1);
        metric.window_count = metric.window_count.saturating_add(1);
        metric.wall_total_ns = metric.wall_total_ns.saturating_add(wall_ns);
        metric.wall_max_ns = metric.wall_max_ns.max(wall_ns);
        metric.wall_last_ns = wall_ns;
        metric.last_finished_ms = now_ms;
        if let Some(cpu_ns) = cpu_ns {
            metric.cpu_sample_count = metric.cpu_sample_count.saturating_add(1);
            metric.cpu_total_ns = metric.cpu_total_ns.saturating_add(cpu_ns);
            metric.window_cpu_ns = metric.window_cpu_ns.saturating_add(cpu_ns);
            metric.cpu_max_ns = metric.cpu_max_ns.max(cpu_ns);
            metric.cpu_last_ns = Some(cpu_ns);
        }

        backend_cpu_attribution_dump_enabled()
            && now_ms.saturating_sub(state.last_dump_ms) >= BACKEND_CPU_ATTRIBUTION_DUMP_INTERVAL_MS
            && {
                state.last_dump_ms = now_ms;
                true
            }
    };

    if should_dump {
        backend_cpu_attribution_dump_snapshot("interval");
    }
}

fn backend_cpu_ns_to_ms(value: u128) -> f64 {
    value as f64 / 1_000_000.0
}

pub(crate) fn backend_cpu_attribution_take_window() -> Vec<(String, f64, u64)> {
    let now_ms = backend_cpu_attribution_now_ms();
    let state = BACKEND_CPU_ATTRIBUTION_STATE
        .get_or_init(|| StdMutex::new(BackendCpuAttributionState::new(now_ms)));
    let Ok(mut state) = state.lock() else {
        return Vec::new();
    };

    let mut window = state
        .metrics
        .iter_mut()
        .filter_map(|(tag, metric)| {
            if metric.window_count == 0 {
                return None;
            }
            let cpu_ms = backend_cpu_ns_to_ms(metric.window_cpu_ns);
            let count = metric.window_count;
            metric.window_cpu_ns = 0;
            metric.window_count = 0;
            Some(((*tag).to_string(), cpu_ms, count))
        })
        .collect::<Vec<_>>();

    window.sort_by(|left, right| {
        right
            .1
            .partial_cmp(&left.1)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    window
}

fn backend_cpu_attribution_snapshot_value(reset: bool) -> Value {
    let now_ms = backend_cpu_attribution_now_ms();
    let state = BACKEND_CPU_ATTRIBUTION_STATE
        .get_or_init(|| StdMutex::new(BackendCpuAttributionState::new(now_ms)));
    let Ok(mut state) = state.lock() else {
        return json!({
            "enabled": backend_cpu_attribution_enabled(),
            "error": "Backend CPU attribution state is unavailable.",
        });
    };

    let mut metrics = state
        .metrics
        .iter()
        .map(|(tag, metric)| {
            json!({
                "tag": tag,
                "count": metric.count,
                "cpu_sample_count": metric.cpu_sample_count,
                "total_cpu_ms": backend_cpu_ns_to_ms(metric.cpu_total_ns),
                "total_wall_ms": backend_cpu_ns_to_ms(metric.wall_total_ns),
                "max_cpu_ms": backend_cpu_ns_to_ms(metric.cpu_max_ns),
                "max_wall_ms": backend_cpu_ns_to_ms(metric.wall_max_ns),
                "last_cpu_ms": metric.cpu_last_ns.map(backend_cpu_ns_to_ms),
                "last_wall_ms": backend_cpu_ns_to_ms(metric.wall_last_ns),
                "avg_cpu_ms": if metric.cpu_sample_count > 0 {
                    backend_cpu_ns_to_ms(metric.cpu_total_ns / u128::from(metric.cpu_sample_count))
                } else {
                    0.0
                },
                "avg_wall_ms": if metric.count > 0 {
                    backend_cpu_ns_to_ms(metric.wall_total_ns / u128::from(metric.count))
                } else {
                    0.0
                },
                "last_finished_ms": metric.last_finished_ms,
            })
        })
        .collect::<Vec<_>>();

    metrics.sort_by(|left, right| {
        let left_cpu = left
            .get("total_cpu_ms")
            .and_then(Value::as_f64)
            .unwrap_or_default();
        let right_cpu = right
            .get("total_cpu_ms")
            .and_then(Value::as_f64)
            .unwrap_or_default();
        right_cpu
            .partial_cmp(&left_cpu)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let payload = json!({
        "enabled": backend_cpu_attribution_enabled(),
        "sampled_at_ms": now_ms,
        "started_at_ms": state.started_at_ms,
        "pid": std::process::id(),
        "thread_cpu_supported": backend_thread_cpu_time_ns().is_some(),
        "dump_path": backend_cpu_attribution_dump_path().to_string_lossy().to_string(),
        "metrics": metrics,
    });

    if reset {
        state.metrics.clear();
        state.started_at_ms = now_ms;
        state.last_dump_ms = now_ms;
    }

    payload
}

fn backend_cpu_attribution_dump_path() -> PathBuf {
    env::temp_dir().join(BACKEND_CPU_ATTRIBUTION_FILE_NAME)
}

fn backend_cpu_attribution_dump_snapshot(reason: &str) {
    if !backend_cpu_attribution_dump_enabled() {
        return;
    }
    let mut payload = backend_cpu_attribution_snapshot_value(false);
    payload["reason"] = json!(reason);
    let _ = fs::write(
        backend_cpu_attribution_dump_path(),
        serde_json::to_vec_pretty(&payload).unwrap_or_default(),
    );
}

#[tauri::command(rename_all = "snake_case")]
async fn backend_cpu_attribution_snapshot(reset: Option<bool>) -> Result<Value, String> {
    Ok(backend_cpu_attribution_snapshot_value(reset.unwrap_or(false)))
}

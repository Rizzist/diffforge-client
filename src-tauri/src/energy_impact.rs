use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    env, fs,
    io::Write,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex as StdMutex, OnceLock,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

// Debug builds self-instrument every launch (2s sampler, no subprocesses,
// ~zero cost) so user-reported Energy Impact numbers are always attributable
// without orchestrating an env-var launch. Release stays opt-in via env.
pub(crate) const ENERGY_IMPACT_LOGGING_DEFAULT: bool = cfg!(debug_assertions);
const ENERGY_IMPACT_LOG_ENV: &str = "DIFFFORGE_ENERGY_IMPACT_LOG";
const ENERGY_IMPACT_LOG_FILE: &str = "energy-impact.jsonl";
const ENERGY_IMPACT_LOG_MAX_BYTES: u64 = 16 * 1024 * 1024;
const ENERGY_IMPACT_SAMPLE_INTERVAL_MS: u64 = 2_000;
const ENERGY_IMPACT_HEARTBEAT_INTERVAL_MS: u64 = 60_000;
const ENERGY_IMPACT_SPIKE_THRESHOLD_PCT: f64 = 120.0;
const ENERGY_IMPACT_OWN_SPIKE_THRESHOLD_PCT: f64 = 60.0;
const ENERGY_IMPACT_WEBVIEW_REFRESH_SAMPLES: u64 = 5;
const ENERGY_IMPACT_MAX_DESCENDANTS: usize = 256;
const ENERGY_IMPACT_MAX_DESCENDANT_DEPTH: usize = 4;
const ENERGY_IMPACT_PROCESS_TOP_N: usize = 10;
const ENERGY_IMPACT_SPAN_TOP_N: usize = 10;
const ENERGY_IMPACT_HEARTBEAT_SPAN_TOP_N: usize = 3;
const ENERGY_IMPACT_MIN_PROCESS_PCT: f64 = 1.0;
const ENERGY_IMPACT_SLEEP_POLL_MS: u64 = 250;
const ENERGY_IMPACT_PROC_ALL_PIDS: u32 = 1;
const ENERGY_IMPACT_INITIAL_ALL_PID_BUFFER: usize = 4096;
const ENERGY_IMPACT_MAX_ALL_PID_BUFFER: usize = 32768;
const ENERGY_IMPACT_PROC_NAME_BYTES: usize = 1024;
const ENERGY_IMPACT_TEXT_MAX: usize = 512;

static ENERGY_IMPACT_ENABLED: OnceLock<bool> = OnceLock::new();
static ENERGY_IMPACT_LOG_LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
static ENERGY_IMPACT_STARTED: AtomicBool = AtomicBool::new(false);

pub(crate) fn energy_impact_enabled() -> bool {
    *ENERGY_IMPACT_ENABLED.get_or_init(|| {
        ENERGY_IMPACT_LOGGING_DEFAULT || energy_impact_env_truthy(ENERGY_IMPACT_LOG_ENV)
    })
}

fn energy_impact_env_truthy(name: &str) -> bool {
    env::var(name)
        .ok()
        .map(|value| {
            let value = value.trim().to_ascii_lowercase();
            !matches!(value.as_str(), "" | "0" | "false" | "off" | "no")
        })
        .unwrap_or(false)
}

pub(crate) fn energy_impact_start() {
    energy_impact_start_impl();
}

#[cfg(target_os = "macos")]
fn energy_impact_start_impl() {
    if !energy_impact_enabled() || crate::app_shutdown_requested() {
        return;
    }
    if ENERGY_IMPACT_STARTED.swap(true, Ordering::AcqRel) {
        return;
    }

    match thread::Builder::new()
        .name("energy-impact".to_string())
        .spawn(run_energy_impact_sampler)
    {
        Ok(_) => {}
        Err(_) => {
            ENERGY_IMPACT_STARTED.store(false, Ordering::Release);
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn energy_impact_start_impl() {}

pub(crate) fn energy_impact_log_render_storm(phase: &str, source: &str, fields: Value) {
    if !energy_impact_enabled() {
        return;
    }

    write_energy_impact_log_entry(json!({
        "ts_ms": energy_impact_now_ms(),
        "kind": "render_storm",
        "phase": clean_energy_impact_text(phase),
        "source": clean_energy_impact_text(source),
        "app_pid": std::process::id(),
        "fields": fields,
    }));
}

fn energy_impact_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

fn clean_energy_impact_text(value: &str) -> String {
    value
        .replace(|character: char| character.is_control(), " ")
        .trim()
        .chars()
        .take(ENERGY_IMPACT_TEXT_MAX)
        .collect()
}

fn write_energy_impact_log_entry(entry: Value) {
    if !energy_impact_enabled() {
        return;
    }

    let log_path = crate::diagnostic_log_path(ENERGY_IMPACT_LOG_FILE);
    let Some(log_dir) = log_path.parent() else {
        return;
    };

    if fs::create_dir_all(log_dir).is_err() {
        return;
    }

    let lock = ENERGY_IMPACT_LOG_LOCK.get_or_init(|| StdMutex::new(()));
    let Ok(_guard) = lock.lock() else {
        return;
    };

    if fs::metadata(&log_path)
        .map(|metadata| metadata.len() >= ENERGY_IMPACT_LOG_MAX_BYTES)
        .unwrap_or(false)
    {
        let rotated = log_path.with_extension("jsonl.1");
        let _ = fs::rename(&log_path, rotated);
    }

    let Ok(mut file) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    else {
        return;
    };

    let _ = writeln!(file, "{entry}");
}

#[cfg(target_os = "macos")]
#[derive(Clone)]
struct ProcessPct {
    pid: libc::pid_t,
    name: String,
    pct: f64,
}

#[cfg(target_os = "macos")]
struct EnergyImpactSampler {
    own_pid: libc::pid_t,
    last_sample_at: Option<Instant>,
    last_heartbeat_at: Option<Instant>,
    sample_count: u64,
    last_own_cpu_ns: Option<u64>,
    last_child_cpu_ns: HashMap<libc::pid_t, u64>,
    last_webview_cpu_ns: HashMap<libc::pid_t, u64>,
    webview_names: HashMap<libc::pid_t, String>,
    all_pid_buffer: Vec<libc::pid_t>,
    child_pid_buffer: Vec<libc::pid_t>,
}

#[cfg(target_os = "macos")]
impl EnergyImpactSampler {
    fn new() -> Self {
        Self {
            own_pid: std::process::id() as libc::pid_t,
            last_sample_at: None,
            last_heartbeat_at: None,
            sample_count: 0,
            last_own_cpu_ns: None,
            last_child_cpu_ns: HashMap::new(),
            last_webview_cpu_ns: HashMap::new(),
            webview_names: HashMap::new(),
            all_pid_buffer: vec![0; ENERGY_IMPACT_INITIAL_ALL_PID_BUFFER],
            child_pid_buffer: vec![0; ENERGY_IMPACT_MAX_DESCENDANTS],
        }
    }

    fn sample(&mut self) {
        let sampled_at = Instant::now();
        let interval_secs = self
            .last_sample_at
            .map(|last| sampled_at.duration_since(last).as_secs_f64())
            .filter(|value| *value > 0.0)
            .unwrap_or_else(|| ENERGY_IMPACT_SAMPLE_INTERVAL_MS as f64 / 1_000.0);
        self.last_sample_at = Some(sampled_at);
        self.sample_count = self.sample_count.saturating_add(1);

        let own_pct = self.sample_own_pct(interval_secs);
        let descendant_pids = self.collect_descendants();
        let descendant_set = descendant_pids.iter().copied().collect::<HashSet<_>>();
        let (children_total_pct, children) = sample_pid_group(
            &descendant_pids,
            &mut self.last_child_cpu_ns,
            interval_secs,
            None,
        );

        if self.sample_count == 1 || self.sample_count % ENERGY_IMPACT_WEBVIEW_REFRESH_SAMPLES == 0
        {
            self.refresh_webview_cache();
        }

        let webview_pids = self
            .webview_names
            .keys()
            .copied()
            .filter(|pid| !descendant_set.contains(pid))
            .collect::<Vec<_>>();
        let (webview_total_pct, webview) = sample_pid_group(
            &webview_pids,
            &mut self.last_webview_cpu_ns,
            interval_secs,
            Some(&self.webview_names),
        );

        let total_pct = own_pct + children_total_pct + webview_total_pct;
        let mut spans = crate::backend_cpu_attribution_take_window();
        spans.sort_by(|left, right| {
            right
                .1
                .partial_cmp(&left.1)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        let spike = total_pct >= ENERGY_IMPACT_SPIKE_THRESHOLD_PCT
            || own_pct >= ENERGY_IMPACT_OWN_SPIKE_THRESHOLD_PCT;
        let heartbeat = self
            .last_heartbeat_at
            .map(|last| {
                sampled_at.duration_since(last).as_millis()
                    >= u128::from(ENERGY_IMPACT_HEARTBEAT_INTERVAL_MS)
            })
            .unwrap_or(true);

        if !spike && !heartbeat {
            return;
        }
        if heartbeat {
            self.last_heartbeat_at = Some(sampled_at);
        }

        let kind = if spike { "spike" } else { "heartbeat" };
        let span_limit = if spike {
            ENERGY_IMPACT_SPAN_TOP_N
        } else {
            ENERGY_IMPACT_HEARTBEAT_SPAN_TOP_N
        };

        write_energy_impact_log_entry(json!({
            "ts_ms": energy_impact_now_ms(),
            "kind": kind,
            "total_pct": round_energy_value(total_pct),
            "own_pct": round_energy_value(own_pct),
            "children": process_pct_values(&children),
            "webview": process_pct_values(&webview),
            "spans": span_values(&spans, span_limit),
        }));
    }

    fn sample_own_pct(&mut self, interval_secs: f64) -> f64 {
        let Some(cpu_ns) = process_cpu_time_ns(self.own_pid) else {
            return 0.0;
        };
        let pct = self
            .last_own_cpu_ns
            .map(|last| pct_from_cpu_delta(cpu_ns, last, interval_secs))
            .unwrap_or(0.0);
        self.last_own_cpu_ns = Some(cpu_ns);
        pct
    }

    fn collect_descendants(&mut self) -> Vec<libc::pid_t> {
        let mut descendants = Vec::new();
        let mut seen = HashSet::new();
        let mut queue = VecDeque::new();
        queue.push_back((self.own_pid, 0usize));

        while let Some((ppid, depth)) = queue.pop_front() {
            if depth >= ENERGY_IMPACT_MAX_DESCENDANT_DEPTH
                || descendants.len() >= ENERGY_IMPACT_MAX_DESCENDANTS
            {
                continue;
            }

            let child_pids = self.list_child_pids(ppid);
            for pid in child_pids {
                if pid <= 0 || pid == self.own_pid || !seen.insert(pid) {
                    continue;
                }
                descendants.push(pid);
                if descendants.len() >= ENERGY_IMPACT_MAX_DESCENDANTS {
                    break;
                }
                queue.push_back((pid, depth + 1));
            }
        }

        descendants
    }

    fn list_child_pids(&mut self, ppid: libc::pid_t) -> Vec<libc::pid_t> {
        self.child_pid_buffer.fill(0);
        let result = unsafe {
            libc::proc_listchildpids(
                ppid,
                self.child_pid_buffer.as_mut_ptr() as *mut libc::c_void,
                buffer_bytes(&self.child_pid_buffer),
            )
        };
        if result <= 0 {
            return Vec::new();
        }

        let count = (result as usize).min(self.child_pid_buffer.len());
        self.child_pid_buffer[..count]
            .iter()
            .copied()
            .filter(|pid| *pid > 0)
            .collect()
    }

    fn refresh_webview_cache(&mut self) {
        let all_pids = self.list_all_pids();
        let mut refreshed = HashMap::new();

        for pid in all_pids {
            if pid <= 0 || pid == self.own_pid {
                continue;
            }

            let name = process_name(pid);
            let path = process_path(pid).unwrap_or_default();
            if !name.contains("WebKit") && !path.contains("com.apple.WebKit") {
                continue;
            }

            if responsible_pid(pid) == Some(self.own_pid) {
                refreshed.insert(pid, name);
            }
        }

        self.webview_names = refreshed;
    }

    fn list_all_pids(&mut self) -> Vec<libc::pid_t> {
        self.all_pid_buffer.fill(0);
        let buffer_len = self.all_pid_buffer.len();
        let buffer_size = buffer_bytes(&self.all_pid_buffer);
        let result = unsafe {
            libc::proc_listpids(
                ENERGY_IMPACT_PROC_ALL_PIDS,
                0,
                self.all_pid_buffer.as_mut_ptr() as *mut libc::c_void,
                buffer_size,
            )
        };
        if result <= 0 {
            return Vec::new();
        }

        let count = ((result as usize) / std::mem::size_of::<libc::pid_t>()).min(buffer_len);
        let pids = self.all_pid_buffer[..count]
            .iter()
            .copied()
            .filter(|pid| *pid > 0)
            .collect::<Vec<_>>();

        if (result as usize) >= (buffer_size as usize)
            && buffer_len < ENERGY_IMPACT_MAX_ALL_PID_BUFFER
        {
            let next_len = buffer_len
                .saturating_mul(2)
                .min(ENERGY_IMPACT_MAX_ALL_PID_BUFFER);
            self.all_pid_buffer.resize(next_len, 0);
        }

        pids
    }
}

#[cfg(target_os = "macos")]
fn run_energy_impact_sampler() {
    set_energy_impact_thread_qos();
    let mut sampler = EnergyImpactSampler::new();

    loop {
        if crate::app_shutdown_requested() {
            return;
        }

        let started = Instant::now();
        sampler.sample();

        if crate::app_shutdown_requested() {
            return;
        }

        let interval = Duration::from_millis(ENERGY_IMPACT_SAMPLE_INTERVAL_MS);
        let sleep_for = interval.saturating_sub(started.elapsed());
        if !sleep_for.is_zero() && !sleep_interruptibly(sleep_for) {
            return;
        }
    }
}

#[cfg(target_os = "macos")]
fn set_energy_impact_thread_qos() {
    unsafe {
        let _ = libc::pthread_set_qos_class_self_np(libc::qos_class_t::QOS_CLASS_UTILITY, 0);
    }
}

#[cfg(target_os = "macos")]
fn sleep_interruptibly(duration: Duration) -> bool {
    let started = Instant::now();
    while started.elapsed() < duration {
        if crate::app_shutdown_requested() {
            return false;
        }
        let remaining = duration.saturating_sub(started.elapsed());
        thread::sleep(remaining.min(Duration::from_millis(ENERGY_IMPACT_SLEEP_POLL_MS)));
    }
    !crate::app_shutdown_requested()
}

#[cfg(target_os = "macos")]
fn sample_pid_group(
    pids: &[libc::pid_t],
    last_cpu_ns: &mut HashMap<libc::pid_t, u64>,
    interval_secs: f64,
    cached_names: Option<&HashMap<libc::pid_t, String>>,
) -> (f64, Vec<ProcessPct>) {
    let mut current = HashSet::new();
    let mut total_pct = 0.0;
    let mut samples = Vec::new();

    for pid in pids {
        if *pid <= 0 || !current.insert(*pid) {
            continue;
        }
        let Some(cpu_ns) = process_cpu_time_ns(*pid) else {
            continue;
        };
        let pct = last_cpu_ns
            .get(pid)
            .map(|last| pct_from_cpu_delta(cpu_ns, *last, interval_secs))
            .unwrap_or(0.0);
        last_cpu_ns.insert(*pid, cpu_ns);
        total_pct += pct;

        if pct >= ENERGY_IMPACT_MIN_PROCESS_PCT {
            let name = cached_names
                .and_then(|names| names.get(pid).cloned())
                .unwrap_or_else(|| process_name(*pid));
            samples.push(ProcessPct {
                pid: *pid,
                name,
                pct,
            });
        }
    }

    last_cpu_ns.retain(|pid, _| current.contains(pid));
    samples.sort_by(|left, right| {
        right
            .pct
            .partial_cmp(&left.pct)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    samples.truncate(ENERGY_IMPACT_PROCESS_TOP_N);
    (total_pct, samples)
}

/// ri_user_time/ri_system_time are mach absolute time units, NOT nanoseconds:
/// on Apple Silicon the timebase is 125/3 (~41.67 ns per tick), so skipping
/// this conversion underreports CPU ~24x and spikes never cross the threshold.
#[cfg(target_os = "macos")]
#[allow(deprecated)] // libc's mach_timebase_info works; mach2 isn't a dependency
fn mach_ticks_to_ns(ticks: u64) -> u64 {
    static TIMEBASE: OnceLock<(u64, u64)> = OnceLock::new();
    let (numer, denom) = *TIMEBASE.get_or_init(|| {
        let mut info = libc::mach_timebase_info { numer: 0, denom: 0 };
        let status = unsafe { libc::mach_timebase_info(&mut info) };
        if status == libc::KERN_SUCCESS && info.numer > 0 && info.denom > 0 {
            (u64::from(info.numer), u64::from(info.denom))
        } else {
            (1, 1)
        }
    });
    ((u128::from(ticks) * u128::from(numer)) / u128::from(denom)).min(u128::from(u64::MAX)) as u64
}

#[cfg(target_os = "macos")]
fn process_cpu_time_ns(pid: libc::pid_t) -> Option<u64> {
    let mut usage = std::mem::MaybeUninit::<libc::rusage_info_v4>::uninit();
    let result = unsafe {
        libc::proc_pid_rusage(
            pid as libc::c_int,
            libc::RUSAGE_INFO_V4,
            usage.as_mut_ptr() as *mut libc::rusage_info_t,
        )
    };
    if result != 0 {
        return None;
    }

    let usage = unsafe { usage.assume_init() };
    Some(mach_ticks_to_ns(
        usage.ri_user_time.saturating_add(usage.ri_system_time),
    ))
}

#[cfg(target_os = "macos")]
fn pct_from_cpu_delta(current_ns: u64, previous_ns: u64, interval_secs: f64) -> f64 {
    if interval_secs <= 0.0 || current_ns < previous_ns {
        return 0.0;
    }

    let delta_ns = current_ns.saturating_sub(previous_ns);
    (delta_ns as f64 / 1_000_000_000.0 / interval_secs) * 100.0
}

#[cfg(target_os = "macos")]
fn process_name(pid: libc::pid_t) -> String {
    let mut buffer = [0 as libc::c_char; ENERGY_IMPACT_PROC_NAME_BYTES];
    let result = unsafe {
        libc::proc_name(
            pid as libc::c_int,
            buffer.as_mut_ptr() as *mut libc::c_void,
            buffer.len() as u32,
        )
    };
    if result <= 0 {
        return format!("pid-{pid}");
    }

    let byte_len = (result as usize).min(buffer.len());
    let bytes = unsafe { std::slice::from_raw_parts(buffer.as_ptr() as *const u8, byte_len) };
    let nul = bytes
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(bytes.len());
    let name = String::from_utf8_lossy(&bytes[..nul]).trim().to_string();
    if name.is_empty() {
        format!("pid-{pid}")
    } else {
        clean_energy_impact_text(&name)
    }
}

#[cfg(target_os = "macos")]
fn process_path(pid: libc::pid_t) -> Option<String> {
    let mut buffer = [0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
    let result = unsafe {
        libc::proc_pidpath(
            pid as libc::c_int,
            buffer.as_mut_ptr() as *mut libc::c_void,
            buffer.len() as u32,
        )
    };
    if result <= 0 {
        return None;
    }

    let byte_len = (result as usize).min(buffer.len());
    let bytes = &buffer[..byte_len];
    let nul = bytes
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(bytes.len());
    Some(String::from_utf8_lossy(&bytes[..nul]).to_string())
}

#[cfg(target_os = "macos")]
type ResponsibilityPidFn = unsafe extern "C" fn(libc::pid_t) -> libc::pid_t;

#[cfg(target_os = "macos")]
static RESPONSIBILITY_PID_FN: OnceLock<Option<ResponsibilityPidFn>> = OnceLock::new();

#[cfg(target_os = "macos")]
fn responsibility_pid_fn() -> Option<ResponsibilityPidFn> {
    *RESPONSIBILITY_PID_FN.get_or_init(|| {
        let symbol = b"responsibility_get_pid_responsible_for_pid\0";
        let raw =
            unsafe { libc::dlsym(libc::RTLD_DEFAULT, symbol.as_ptr() as *const libc::c_char) };
        if raw.is_null() {
            None
        } else {
            Some(unsafe { std::mem::transmute::<*mut libc::c_void, ResponsibilityPidFn>(raw) })
        }
    })
}

#[cfg(target_os = "macos")]
fn responsible_pid(pid: libc::pid_t) -> Option<libc::pid_t> {
    let function = responsibility_pid_fn()?;
    let responsible = unsafe { function(pid) };
    (responsible > 0).then_some(responsible)
}

#[cfg(target_os = "macos")]
fn buffer_bytes<T>(buffer: &[T]) -> libc::c_int {
    buffer
        .len()
        .saturating_mul(std::mem::size_of::<T>())
        .min(libc::c_int::MAX as usize) as libc::c_int
}

#[cfg(target_os = "macos")]
fn process_pct_values(processes: &[ProcessPct]) -> Vec<Value> {
    processes
        .iter()
        .map(|process| {
            json!({
                "pid": process.pid,
                "name": process.name.as_str(),
                "pct": round_energy_value(process.pct),
            })
        })
        .collect()
}

fn span_values(spans: &[(String, f64, u64)], limit: usize) -> Vec<Value> {
    spans
        .iter()
        .take(limit)
        .map(|(tag, cpu_ms, count)| {
            json!({
                "tag": clean_energy_impact_text(tag),
                "cpu_ms": round_cpu_ms(*cpu_ms),
                "count": count,
            })
        })
        .collect()
}

fn round_energy_value(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn round_cpu_ms(value: f64) -> f64 {
    (value * 1_000.0).round() / 1_000.0
}

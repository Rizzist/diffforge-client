// Over-the-wire app updates (tauri-plugin-updater). The app checks the
// signed manifest at plugins.updater.endpoints on startup and every few
// hours, downloads in the background only when the user asks, and restarts
// only from the explicit restart affordance or the user's idle-restart opt-in.
//
// Env overrides: DIFFFORGE_UPDATER_URL replaces the manifest endpoint;
// DIFFFORGE_UPDATER_FORCE=1 enables checks in debug builds (off by default
// so `npm run dev` never talks to the release feed);
// DIFFFORGE_DAEMON_AUTO_UPDATE=0 disables daemon-mode idle auto-restart.

use tauri_plugin_updater::UpdaterExt as AppUpdaterExt;

const APP_UPDATE_AVAILABLE_EVENT: &str = "forge-app-update-available";
const APP_UPDATE_PROGRESS_EVENT: &str = "forge-app-update-progress";
const APP_UPDATE_STATE_EVENT: &str = "forge-app-update-state";
const APP_UPDATE_RECHECK_INTERVAL_SECS: u64 = 4 * 60 * 60;
const APP_UPDATE_CHECK_RETRY_LADDER_SECS: [u64; 3] = [30, 2 * 60, 10 * 60];
const APP_UPDATE_PROGRESS_STEP_BYTES: u64 = 1024 * 1024;
// While an update is pending and auto-restart is enabled, poll terminal
// idleness on this cadence, and require it to hold across a confirmation
// pause so a just-submitted prompt never races the restart.
const APP_UPDATE_IDLE_POLL_SECS: u64 = 5 * 60;
const APP_UPDATE_IDLE_CONFIRM_SECS: u64 = 60;
const APP_UPDATE_EXIT_TERMINAL_DELIVERY_ATTEMPTS: usize = 3;
const APP_UPDATE_EXIT_TERMINAL_DELIVERY_RETRY_MS: u64 = 500;
const APP_UPDATE_SETTINGS_STATE_KEY: &str = "app-update-settings";
const APP_UPDATE_STATE_IDLE: u8 = 0;
const APP_UPDATE_STATE_CHECKING: u8 = 1;
const APP_UPDATE_STATE_DOWNLOADING: u8 = 2;
const APP_UPDATE_STATE_READY: u8 = 3;
const APP_UPDATE_STATE_RESTARTING: u8 = 4;
const APP_UPDATE_STATE_FAILED: u8 = 5;

static APP_UPDATE_INSTALLING: AtomicBool = AtomicBool::new(false);
// Consecutive network-class check failures. Shared (not loop-local) so a
// SUCCESSFUL check from ANY path — including a manual retry while the
// background loop sleeps in its retry ladder — resets the quiet-first-failure
// accounting.
static APP_UPDATE_CHECK_NETWORK_FAILURES: AtomicUsize = AtomicUsize::new(0);
// GUI mode is opt-in. Daemons default to on unless DIFFFORGE_DAEMON_AUTO_UPDATE=0.
static APP_UPDATE_AUTO_WHEN_IDLE: AtomicBool = AtomicBool::new(false);
static APP_UPDATE_AUTH_TRANSPORT_RESTART_DEFERRED: AtomicBool = AtomicBool::new(false);
static APP_UPDATE_AUTH_RESTART_BLOCKED: AtomicBool = AtomicBool::new(false);
static APP_UPDATE_STATE: AtomicU8 = AtomicU8::new(APP_UPDATE_STATE_IDLE);
static APP_UPDATE_AVAILABLE: StdMutex<Option<AppUpdateInfo>> = StdMutex::new(None);
static APP_UPDATE_STAGED: StdMutex<Option<AppUpdateStaged>> = StdMutex::new(None);
static APP_UPDATE_LAST_ERROR: StdMutex<Option<String>> = StdMutex::new(None);
static APP_UPDATE_REMOTE_COMMAND_TOKEN: AtomicU64 = AtomicU64::new(0);
static APP_UPDATE_REMOTE_ADMISSION_CLOSED: AtomicBool = AtomicBool::new(false);
static APP_UPDATE_REMOTE_ADMISSION: std::sync::RwLock<()> = std::sync::RwLock::new(());
static APP_UPDATE_REMOTE_OPERATION: StdMutex<AppUpdateRemoteOperation> =
    StdMutex::new(AppUpdateRemoteOperation {
        generation: 1,
        phase: AppUpdateOperationPhase::Idle,
        attached: Vec::new(),
    });

#[derive(Clone)]
struct AppUpdateRemoteCommandContext {
    token: u64,
    state: CloudMcpState,
    event: Value,
    reply: AppUpdateRemoteReplyState,
}

struct AppUpdateRemoteOperation {
    generation: u64,
    phase: AppUpdateOperationPhase,
    attached: Vec<AppUpdateRemoteCommandContext>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum AppUpdateOperationPhase {
    Idle,
    Active,
    RestartPending {
        watcher_active: bool,
    },
    Restarting,
    Terminal {
        status: AppUpdateRemoteTerminalStatus,
        advance_when_drained: bool,
        before_exit: bool,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AppUpdateOperationPhaseKind {
    Active,
    RestartPending,
    Restarting,
    Terminal,
}

impl AppUpdateOperationPhase {
    fn kind(&self) -> Option<AppUpdateOperationPhaseKind> {
        match self {
            Self::Idle => None,
            Self::Active => Some(AppUpdateOperationPhaseKind::Active),
            Self::RestartPending { .. } => Some(AppUpdateOperationPhaseKind::RestartPending),
            Self::Restarting => Some(AppUpdateOperationPhaseKind::Restarting),
            Self::Terminal { .. } => Some(AppUpdateOperationPhaseKind::Terminal),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AppUpdateRemoteReplyState {
    Pending,
    SendingNonterminal,
    NonterminalSent,
    SendingTerminal,
}

#[derive(Clone, Copy)]
pub(crate) struct AppUpdateRemoteCommandBinding {
    token: u64,
    generation: u64,
    started_new: bool,
    phase: AppUpdateOperationPhaseKind,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct AppUpdateRemoteTerminalStatus {
    status: String,
    message: String,
}

struct AppUpdateTerminalDelivery {
    contexts: Vec<AppUpdateRemoteCommandContext>,
    terminal: AppUpdateRemoteTerminalStatus,
    before_exit: bool,
}

struct AppUpdateTerminalAttemptOutcome {
    retry: bool,
    before_exit: bool,
}

enum AppUpdateDownloadFinish {
    Finished,
    RestartPending(u64),
    Stale,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct AppUpdateCheckRetryState {
    consecutive_network_failures: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AppUpdateCheckFailureReporting {
    StoreAndPublish,
    ReturnOnly,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct AppUpdateCheckFailureDecision {
    next_state: AppUpdateCheckRetryState,
    retry_after_secs: u64,
    publish_failed_state: bool,
}

impl AppUpdateRemoteOperation {
    fn advance(&mut self) {
        self.generation = self.generation.wrapping_add(1).max(1);
        self.phase = AppUpdateOperationPhase::Idle;
    }

    fn begin_download(&mut self) -> Option<u64> {
        if self.phase != AppUpdateOperationPhase::Idle {
            return None;
        }
        self.phase = AppUpdateOperationPhase::Active;
        Some(self.generation)
    }

    fn begin_install(&mut self, expected_generation: Option<u64>) -> Option<u64> {
        if expected_generation.is_some_and(|expected| expected != self.generation) {
            return None;
        }
        match &self.phase {
            AppUpdateOperationPhase::Idle if expected_generation.is_none() => {
                self.phase = AppUpdateOperationPhase::Restarting;
                Some(self.generation)
            }
            AppUpdateOperationPhase::RestartPending { .. } => {
                self.phase = AppUpdateOperationPhase::Restarting;
                Some(self.generation)
            }
            _ => None,
        }
    }

    fn bind(&mut self, context: AppUpdateRemoteCommandContext) -> AppUpdateRemoteCommandBinding {
        let started_new = if self.phase == AppUpdateOperationPhase::Idle {
            self.phase = AppUpdateOperationPhase::Active;
            true
        } else {
            false
        };
        let binding = AppUpdateRemoteCommandBinding {
            token: context.token,
            generation: self.generation,
            started_new,
            phase: self
                .phase
                .kind()
                .expect("bound app-update operation must be active"),
        };
        self.attached.push(context);
        binding
    }

    fn contains(&self, binding: AppUpdateRemoteCommandBinding) -> bool {
        self.generation == binding.generation
            && self
                .attached
                .iter()
                .any(|context| context.token == binding.token)
    }

    fn release(&mut self, binding: AppUpdateRemoteCommandBinding) -> bool {
        if self.generation != binding.generation {
            return false;
        }
        let Some(index) = self
            .attached
            .iter()
            .position(|context| context.token == binding.token)
        else {
            return false;
        };
        self.attached.remove(index);
        self.advance_terminal_if_drained();
        true
    }

    fn begin_nonterminal_reply(
        &mut self,
        binding: AppUpdateRemoteCommandBinding,
    ) -> Option<AppUpdateRemoteCommandContext> {
        if self.generation != binding.generation
            || matches!(
                &self.phase,
                AppUpdateOperationPhase::Idle | AppUpdateOperationPhase::Terminal { .. }
            )
        {
            return None;
        }
        let context = self
            .attached
            .iter_mut()
            .find(|context| context.token == binding.token)?;
        if context.reply != AppUpdateRemoteReplyState::Pending {
            return None;
        }
        context.reply = AppUpdateRemoteReplyState::SendingNonterminal;
        Some(context.clone())
    }

    fn finish_nonterminal_reply(
        &mut self,
        binding: AppUpdateRemoteCommandBinding,
    ) -> Option<AppUpdateTerminalDelivery> {
        if self.generation != binding.generation {
            return None;
        }
        let terminal = match &self.phase {
            AppUpdateOperationPhase::Terminal {
                status,
                before_exit,
                ..
            } => Some((status.clone(), *before_exit)),
            AppUpdateOperationPhase::Idle => return None,
            _ => None,
        };
        let context = self
            .attached
            .iter_mut()
            .find(|context| context.token == binding.token)?;
        if context.reply != AppUpdateRemoteReplyState::SendingNonterminal {
            return None;
        }
        if let Some((terminal, before_exit)) = terminal {
            context.reply = AppUpdateRemoteReplyState::SendingTerminal;
            Some(AppUpdateTerminalDelivery {
                contexts: vec![context.clone()],
                terminal,
                before_exit,
            })
        } else {
            context.reply = AppUpdateRemoteReplyState::NonterminalSent;
            None
        }
    }

    fn claim_bound_terminal(
        &mut self,
        binding: AppUpdateRemoteCommandBinding,
    ) -> Option<AppUpdateTerminalDelivery> {
        if self.generation != binding.generation {
            return None;
        }
        let AppUpdateOperationPhase::Terminal {
            status,
            before_exit,
            ..
        } = &self.phase
        else {
            return None;
        };
        let terminal = status.clone();
        let before_exit = *before_exit;
        let context = self
            .attached
            .iter_mut()
            .find(|context| context.token == binding.token)?;
        if !matches!(
            context.reply,
            AppUpdateRemoteReplyState::Pending | AppUpdateRemoteReplyState::NonterminalSent
        ) {
            return None;
        }
        context.reply = AppUpdateRemoteReplyState::SendingTerminal;
        Some(AppUpdateTerminalDelivery {
            contexts: vec![context.clone()],
            terminal,
            before_exit,
        })
    }

    fn mark_restart_pending(&mut self, generation: u64) -> bool {
        if self.generation != generation || self.phase != AppUpdateOperationPhase::Active {
            return false;
        }
        self.phase = AppUpdateOperationPhase::RestartPending {
            watcher_active: false,
        };
        true
    }

    fn finish_download(&mut self, generation: u64) -> AppUpdateDownloadFinish {
        if self.generation != generation || self.phase != AppUpdateOperationPhase::Active {
            return AppUpdateDownloadFinish::Stale;
        }
        if self.attached.is_empty() {
            self.advance();
            AppUpdateDownloadFinish::Finished
        } else {
            self.phase = AppUpdateOperationPhase::RestartPending {
                watcher_active: false,
            };
            AppUpdateDownloadFinish::RestartPending(generation)
        }
    }

    fn claim_restart_watcher(&mut self, generation: u64) -> bool {
        if self.generation != generation {
            return false;
        }
        let AppUpdateOperationPhase::RestartPending { watcher_active } = &mut self.phase else {
            return false;
        };
        if *watcher_active {
            return false;
        }
        *watcher_active = true;
        true
    }

    fn finish_restart_watcher(&mut self, generation: u64) {
        if self.generation != generation {
            return;
        }
        if let AppUpdateOperationPhase::RestartPending { watcher_active } = &mut self.phase {
            *watcher_active = false;
        }
    }

    fn commit_terminal(
        &mut self,
        generation: u64,
        terminal: AppUpdateRemoteTerminalStatus,
        advance_when_drained: bool,
    ) -> Option<AppUpdateTerminalDelivery> {
        if self.generation != generation
            || matches!(
                &self.phase,
                AppUpdateOperationPhase::Idle | AppUpdateOperationPhase::Terminal { .. }
            )
        {
            return None;
        }
        self.phase = AppUpdateOperationPhase::Terminal {
            status: terminal.clone(),
            advance_when_drained,
            before_exit: !advance_when_drained,
        };
        let contexts = self
            .attached
            .iter_mut()
            .filter_map(|context| {
                if context.reply == AppUpdateRemoteReplyState::SendingNonterminal {
                    return None;
                }
                context.reply = AppUpdateRemoteReplyState::SendingTerminal;
                Some(context.clone())
            })
            .collect();
        self.advance_terminal_if_drained();
        Some(AppUpdateTerminalDelivery {
            contexts,
            terminal,
            before_exit: !advance_when_drained,
        })
    }

    fn commit_restart_pending_terminal(
        &mut self,
        generation: u64,
        terminal: AppUpdateRemoteTerminalStatus,
    ) -> Option<AppUpdateTerminalDelivery> {
        if self.generation != generation
            || !matches!(&self.phase, AppUpdateOperationPhase::RestartPending { .. })
        {
            return None;
        }
        self.commit_terminal(generation, terminal, true)
    }

    fn commit_shutdown_terminal(
        &mut self,
        terminal: AppUpdateRemoteTerminalStatus,
    ) -> Option<(u64, AppUpdateTerminalDelivery)> {
        if !matches!(
            &self.phase,
            AppUpdateOperationPhase::Active
                | AppUpdateOperationPhase::RestartPending { .. }
                | AppUpdateOperationPhase::Restarting
        ) {
            return None;
        }
        let generation = self.generation;
        self.phase = AppUpdateOperationPhase::Terminal {
            status: terminal.clone(),
            advance_when_drained: true,
            before_exit: true,
        };
        let contexts = self
            .attached
            .iter_mut()
            .filter_map(|context| {
                if context.reply == AppUpdateRemoteReplyState::SendingNonterminal {
                    return None;
                }
                context.reply = AppUpdateRemoteReplyState::SendingTerminal;
                Some(context.clone())
            })
            .collect();
        self.advance_terminal_if_drained();
        Some((
            generation,
            AppUpdateTerminalDelivery {
                contexts,
                terminal,
                before_exit: true,
            },
        ))
    }

    fn claim_pending_terminal_delivery(
        &mut self,
        generation: u64,
        before_exit: bool,
    ) -> Option<AppUpdateTerminalDelivery> {
        if self.generation != generation {
            return None;
        }
        let AppUpdateOperationPhase::Terminal {
            status,
            before_exit: terminal_before_exit,
            ..
        } = &mut self.phase
        else {
            return None;
        };
        *terminal_before_exit |= before_exit;
        let status = status.clone();
        let contexts = self
            .attached
            .iter_mut()
            .filter_map(|context| {
                if !matches!(
                    context.reply,
                    AppUpdateRemoteReplyState::Pending | AppUpdateRemoteReplyState::NonterminalSent
                ) {
                    return None;
                }
                context.reply = AppUpdateRemoteReplyState::SendingTerminal;
                Some(context.clone())
            })
            .collect();
        Some(AppUpdateTerminalDelivery {
            contexts,
            terminal: status,
            before_exit: *terminal_before_exit,
        })
    }

    fn active_generation(&self) -> Option<u64> {
        (self.phase != AppUpdateOperationPhase::Idle).then_some(self.generation)
    }

    fn finish_shutdown_drain(&mut self, generation: u64) -> bool {
        if self.generation != generation || !self.attached.is_empty() {
            return false;
        }
        self.advance();
        true
    }

    fn finish_terminal_reply(&mut self, generation: u64, token: u64) -> bool {
        if self.generation != generation {
            return false;
        }
        let Some(index) = self.attached.iter().position(|context| {
            context.token == token && context.reply == AppUpdateRemoteReplyState::SendingTerminal
        }) else {
            return false;
        };
        self.attached.remove(index);
        self.advance_terminal_if_drained();
        true
    }

    fn finish_terminal_delivery_attempt(
        &mut self,
        generation: u64,
        token: u64,
        attempts: usize,
        confirmed: bool,
        delivery_before_exit: bool,
    ) -> AppUpdateTerminalAttemptOutcome {
        let generation_before_exit = self.generation == generation
            && matches!(
                &self.phase,
                AppUpdateOperationPhase::Terminal {
                    before_exit: true,
                    ..
                }
            );
        let before_exit = delivery_before_exit
            || generation_before_exit
            || APP_UPDATE_REMOTE_ADMISSION_CLOSED.load(Ordering::Acquire)
            || crate::app_shutdown_requested();
        let context_is_sending = self.generation == generation
            && self.attached.iter().any(|context| {
                context.token == token
                    && context.reply == AppUpdateRemoteReplyState::SendingTerminal
            });
        if context_is_sending
            && before_exit
            && !app_update_exit_terminal_delivery_can_release(attempts, confirmed)
        {
            return AppUpdateTerminalAttemptOutcome {
                retry: true,
                before_exit,
            };
        }
        self.finish_terminal_reply(generation, token);
        AppUpdateTerminalAttemptOutcome {
            retry: false,
            before_exit,
        }
    }

    fn advance_terminal_if_drained(&mut self) {
        if self.attached.is_empty()
            && matches!(
                &self.phase,
                AppUpdateOperationPhase::Terminal {
                    advance_when_drained: true,
                    ..
                }
            )
        {
            self.advance();
        }
    }
}

#[derive(Clone, Serialize)]
struct AppUpdateInfo {
    version: String,
    notes: Option<String>,
}

struct AppUpdateStaged {
    version: String,
    installed: bool,
    bytes: Option<Vec<u8>>,
}

#[derive(Clone, Serialize)]
struct AppUpdateStagedInfo {
    version: String,
    installed: bool,
    has_bytes: bool,
}

struct AppUpdateStagedRestart {
    version: String,
    installed: bool,
    #[cfg(windows)]
    bytes: Option<Vec<u8>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AppUpdateAutomaticRestartAuthDecision {
    Proceed,
    Block,
    Defer,
}

fn app_update_available_snapshot() -> Option<AppUpdateInfo> {
    APP_UPDATE_AVAILABLE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

fn app_update_store_available(info: Option<AppUpdateInfo>) {
    *APP_UPDATE_AVAILABLE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = info;
}

fn app_update_staged_info() -> Option<AppUpdateStagedInfo> {
    APP_UPDATE_STAGED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .as_ref()
        .map(|staged| AppUpdateStagedInfo {
            version: staged.version.clone(),
            installed: staged.installed,
            has_bytes: staged.bytes.is_some(),
        })
}

fn app_update_staged_for_restart() -> Option<AppUpdateStagedRestart> {
    APP_UPDATE_STAGED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .as_ref()
        .map(|staged| AppUpdateStagedRestart {
            version: staged.version.clone(),
            installed: staged.installed,
            #[cfg(windows)]
            bytes: staged.bytes.clone(),
        })
}

fn app_update_store_staged(staged: Option<AppUpdateStaged>) {
    *APP_UPDATE_STAGED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = staged;
}

fn app_update_last_error() -> Option<String> {
    APP_UPDATE_LAST_ERROR
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

fn app_update_check_error_is_network_class(error: &str) -> bool {
    // Classify on prose only: URL host/path text inside the error (e.g. a
    // signature failure quoting an endpoint whose path contains
    // "connection") must not read as a transport failure.
    let error = app_update_check_error_without_urls(error).to_ascii_lowercase();
    [
        "error sending request",
        "connection refused",
        "connection reset",
        "connection closed",
        "connect error",
        "dns error",
        "name resolution",
        "failed to lookup",
        "timed out",
        "operation timed out",
        "network is unreachable",
        "network unreachable",
        "no route to host",
    ]
    .iter()
    .any(|needle| error.contains(needle))
}

/// Strips every URL-looking token (scheme://… through the next whitespace)
/// so classification sees only the error prose.
fn app_update_check_error_without_urls(error: &str) -> String {
    let mut output = String::with_capacity(error.len());
    for token in error.split_whitespace() {
        if token.contains("://") {
            continue;
        }
        if !output.is_empty() {
            output.push(' ');
        }
        output.push_str(token);
    }
    output
}

fn app_update_check_retry_after_secs(consecutive_network_failures: usize) -> u64 {
    consecutive_network_failures
        .checked_sub(1)
        .and_then(|index| APP_UPDATE_CHECK_RETRY_LADDER_SECS.get(index).copied())
        .unwrap_or(APP_UPDATE_RECHECK_INTERVAL_SECS)
}

fn app_update_check_failure_decision(
    state: AppUpdateCheckRetryState,
    error: &str,
) -> AppUpdateCheckFailureDecision {
    if !app_update_check_error_is_network_class(error) {
        return AppUpdateCheckFailureDecision {
            next_state: AppUpdateCheckRetryState::default(),
            retry_after_secs: APP_UPDATE_RECHECK_INTERVAL_SECS,
            publish_failed_state: true,
        };
    }

    let consecutive_network_failures = state.consecutive_network_failures.saturating_add(1);
    AppUpdateCheckFailureDecision {
        next_state: AppUpdateCheckRetryState {
            consecutive_network_failures,
        },
        retry_after_secs: app_update_check_retry_after_secs(consecutive_network_failures),
        publish_failed_state: consecutive_network_failures > 1,
    }
}

/// Removes credentials and request parameters from URL-looking text before an
/// updater error is exposed through device state, remote replies, or logs.
pub(crate) fn app_update_scrub_external_text(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = String::with_capacity(value.len());
    let mut cursor = 0;
    let mut search_from = 0;

    while let Some(relative_separator) = value[search_from..].find("://") {
        let separator = search_from + relative_separator;
        let mut url_start = separator;
        while url_start > 0
            && matches!(
                bytes[url_start - 1],
                b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'+' | b'-' | b'.'
            )
        {
            url_start -= 1;
        }
        if url_start == separator || !bytes[url_start].is_ascii_alphabetic() {
            search_from = separator + 3;
            continue;
        }

        let authority_start = separator + 3;
        let next_url_start =
            value[authority_start..]
                .match_indices("://")
                .find_map(|(offset, _)| {
                    let next_separator = authority_start + offset;
                    let mut next_start = next_separator;
                    while next_start > 0
                        && matches!(
                            bytes[next_start - 1],
                            b'a'..=b'z'
                                | b'A'..=b'Z'
                                | b'0'..=b'9'
                                | b'+'
                                | b'-'
                                | b'.'
                        )
                    {
                        next_start -= 1;
                    }
                    (next_start < next_separator && bytes[next_start].is_ascii_alphabetic())
                        .then_some(next_start)
                });
        let mut url_end = authority_start;
        while url_end < bytes.len()
            && next_url_start != Some(url_end)
            && !bytes[url_end].is_ascii_whitespace()
            && !matches!(bytes[url_end], b'"' | b'\'' | b'`' | b'<' | b'>')
        {
            url_end += 1;
        }

        let visible_end = bytes[authority_start..url_end]
            .iter()
            .position(|byte| matches!(*byte, b'?' | b'#'))
            .map(|offset| authority_start + offset)
            .unwrap_or(url_end);
        let authority_end = bytes[authority_start..visible_end]
            .iter()
            .position(|byte| *byte == b'/')
            .map(|offset| authority_start + offset)
            .unwrap_or(visible_end);
        let host_start = bytes[authority_start..authority_end]
            .iter()
            .rposition(|byte| *byte == b'@')
            .map(|offset| authority_start + offset + 1)
            .unwrap_or(authority_start);

        output.push_str(&value[cursor..url_start]);
        output.push_str(&value[url_start..authority_start]);
        output.push_str(&value[host_start..visible_end]);
        cursor = url_end;
        search_from = url_end;
    }

    output.push_str(&value[cursor..]);
    clean_terminal_telemetry_text(&output)
}

fn app_update_store_last_error(error: Option<String>) {
    *APP_UPDATE_LAST_ERROR
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) =
        error.map(|error| app_update_scrub_external_text(&error));
}

fn app_update_settings_to_value() -> Value {
    json!({
        "auto_restart_when_idle": APP_UPDATE_AUTO_WHEN_IDLE.load(Ordering::Acquire),
    })
}

fn app_update_daemon_auto_update_disabled_from_env_value(value: Option<&str>) -> bool {
    value
        .map(str::trim)
        .map(|value| {
            value == "0"
                || value.eq_ignore_ascii_case("false")
                || value.eq_ignore_ascii_case("off")
                || value.eq_ignore_ascii_case("no")
        })
        .unwrap_or(false)
}

fn app_update_effective_auto_restart_when_idle(
    persisted_auto: bool,
    daemon_mode: bool,
    daemon_auto_env: Option<&str>,
) -> bool {
    if daemon_mode && app_update_daemon_auto_update_disabled_from_env_value(daemon_auto_env) {
        return false;
    }
    persisted_auto || daemon_mode
}

fn app_update_effective_auto_restart_when_idle_for_current_process(persisted_auto: bool) -> bool {
    let daemon_auto_env = std::env::var("DIFFFORGE_DAEMON_AUTO_UPDATE").ok();
    app_update_effective_auto_restart_when_idle(
        persisted_auto,
        crate::daemon_mode_active(),
        daemon_auto_env.as_deref(),
    )
}

fn app_update_persisted_auto_restart_when_idle(raw: &Value) -> bool {
    raw.get("auto_restart_when_idle")
        .or_else(|| raw.get("autoRestartWhenIdle"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

pub(crate) fn app_update_settings_initialize(app: &AppHandle) {
    let raw = app_local_state_read(app, APP_UPDATE_SETTINGS_STATE_KEY);
    let persisted_auto = app_update_persisted_auto_restart_when_idle(&raw);
    let auto = app_update_effective_auto_restart_when_idle_for_current_process(persisted_auto);
    APP_UPDATE_AUTO_WHEN_IDLE.store(auto, Ordering::Release);
}

fn app_update_settings_save(
    app: &AppHandle,
    auto_restart_when_idle: bool,
) -> Result<Value, String> {
    let effective_auto =
        app_update_effective_auto_restart_when_idle_for_current_process(auto_restart_when_idle);
    APP_UPDATE_AUTO_WHEN_IDLE.store(effective_auto, Ordering::Release);
    let value = app_update_settings_to_value();
    app_local_state_write(
        app,
        APP_UPDATE_SETTINGS_STATE_KEY,
        &json!({ "auto_restart_when_idle": auto_restart_when_idle }),
    )?;
    Ok(value)
}

/// True only when no terminal is doing anything: busy turns, starting
/// sessions, and paused/needs-input agents all block an automatic restart.
/// No terminals at all counts as idle.
async fn app_update_all_terminals_idle(app: &AppHandle) -> bool {
    let state = app.state::<TerminalState>();
    let terminals = state.terminals.read().await;
    for instance in terminals.values() {
        let snapshot = instance
            .runtime
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let status = terminal_projection_text(&snapshot.status, "");
        let activity = terminal_projection_text(&snapshot.activity_status, "");
        if terminal_runtime_snapshot_is_busy_turn(&snapshot)
            || terminal_runtime_snapshot_is_starting(&snapshot)
            || terminal_projection_state_is_paused(&status)
            || terminal_projection_state_is_paused(&activity)
        {
            return false;
        }
    }
    true
}

#[cfg(target_os = "linux")]
fn app_update_validate_platform_install_target() -> Result<(), String> {
    // Some launch paths (older installs, extracted runtimes, env-sanitizing
    // wrappers) start the daemon without the AppImage runtime's APPIMAGE
    // variable. The updater (and tauri-plugin-updater's install step, which
    // reads APPIMAGE itself) still has a well-defined target: fall back to
    // the installer-provisioned path, then the stable install locations, and
    // export APPIMAGE so the plugin sees the same target.
    let candidates = std::env::var_os("APPIMAGE")
        .map(|value| PathBuf::from(value.to_string_lossy().trim().to_string()))
        .into_iter()
        .chain(
            std::env::var_os("DIFFFORGE_APPIMAGE_PATH")
                .map(|value| PathBuf::from(value.to_string_lossy().trim().to_string())),
        )
        .chain([PathBuf::from("/opt/diffforge/diffforge-ai.AppImage")])
        .chain(
            crate::user_home_dir()
                .map(|home| home.join(".local/share/diffforge/diffforge-ai.AppImage")),
        )
        .filter(|path| !path.as_os_str().is_empty())
        .collect::<Vec<_>>();
    let Some(appimage) = candidates.iter().find(|path| path.is_file()) else {
        let described = candidates
            .first()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default();
        if described.is_empty() {
            return Err(
                "Linux app updates require an AppImage launch with APPIMAGE set; refusing to run the updater for this install."
                    .to_string(),
            );
        }
        return Err(format!(
            "Linux app updates require APPIMAGE to point at the running AppImage; no install target found (checked from: {})",
            app_update_scrub_external_text(&described)
        ));
    };
    if std::env::var_os("APPIMAGE")
        .map(|value| PathBuf::from(value.to_string_lossy().trim().to_string()))
        .as_deref()
        != Some(appimage.as_path())
    {
        std::env::set_var("APPIMAGE", appimage);
        log_terminal_status_event(
            "backend.app_update.appimage_target_fallback",
            json!({ "target": appimage.to_string_lossy() }),
        );
    }
    Ok(())
}

#[cfg(not(target_os = "linux"))]
fn app_update_validate_platform_install_target() -> Result<(), String> {
    Ok(())
}

fn app_updater_instance(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    app_update_validate_platform_install_target()?;
    let override_url = std::env::var("DIFFFORGE_UPDATER_URL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let builder = app.updater_builder();
    let builder = match override_url {
        Some(raw) => {
            let url = tauri::Url::parse(&raw)
                .map_err(|error| format!("Invalid DIFFFORGE_UPDATER_URL: {error}"))?;
            builder
                .endpoints(vec![url])
                .map_err(|error| format!("Could not apply updater endpoint override: {error}"))?
        }
        None => builder,
    };
    builder
        .build()
        .map_err(|error| format!("Could not build updater: {error}"))
}

fn app_update_status_snapshot() -> Value {
    let available = app_update_available_snapshot();
    let staged = app_update_staged_info();
    let version = staged
        .as_ref()
        .map(|info| info.version.clone())
        .or_else(|| available.as_ref().map(|info| info.version.clone()));
    json!({
        "available": available.is_some() || staged.is_some(),
        "version": version,
        "notes": available.as_ref().and_then(|info| info.notes.clone()),
        "installing": APP_UPDATE_INSTALLING.load(Ordering::Acquire),
        "ready": staged.is_some(),
        "staged": staged,
        "auto_restart_when_idle": APP_UPDATE_AUTO_WHEN_IDLE.load(Ordering::Acquire),
        "error": app_update_last_error(),
        "current_version": env!("CARGO_PKG_VERSION"),
    })
}

fn app_update_state_label(state: u8) -> &'static str {
    match state {
        APP_UPDATE_STATE_CHECKING => "checking",
        APP_UPDATE_STATE_DOWNLOADING => "downloading",
        APP_UPDATE_STATE_READY => "ready",
        APP_UPDATE_STATE_RESTARTING => "restarting",
        APP_UPDATE_STATE_FAILED => "failed",
        _ => "idle",
    }
}

fn app_update_store_state(state: u8) {
    if state != APP_UPDATE_STATE_FAILED {
        app_update_store_last_error(None);
    }
    APP_UPDATE_STATE.store(state, Ordering::Release);
}

fn app_update_store_failed_state(error: &str) {
    app_update_store_last_error(Some(error.to_string()));
    app_update_store_state(APP_UPDATE_STATE_FAILED);
}

fn app_update_publish_device_state(app: &AppHandle, reason: &str) {
    let state = app.state::<CloudMcpState>().inner().clone();
    let reason = reason.to_string();
    tauri::async_runtime::spawn(async move {
        cloud_mcp_publish_device_live_state_snapshot_debounced(&state, &reason).await;
    });
}

async fn app_update_publish_device_state_now(app: &AppHandle, reason: &str) {
    let state = app.state::<CloudMcpState>().inner().clone();
    cloud_mcp_publish_device_live_state_snapshot(&state, reason).await;
}

fn app_update_automatic_restart_auth_decision(
    status: DesktopAuthPreflightStatus,
    daemon_mode: bool,
    transport_deferred_once: bool,
) -> AppUpdateAutomaticRestartAuthDecision {
    if daemon_mode {
        // Headless BYOC daemons authenticate with a device token and have no
        // desktop session UX to protect; an auth-preflight rejection or
        // transport error must not permanently block OTA updates (systemd
        // restarts the daemon, which re-runs auth from scratch).
        return AppUpdateAutomaticRestartAuthDecision::Proceed;
    }
    match status {
        DesktopAuthPreflightStatus::AuthOk | DesktopAuthPreflightStatus::NoSession => {
            AppUpdateAutomaticRestartAuthDecision::Proceed
        }
        DesktopAuthPreflightStatus::AuthRejected => AppUpdateAutomaticRestartAuthDecision::Block,
        DesktopAuthPreflightStatus::TransportError if transport_deferred_once => {
            AppUpdateAutomaticRestartAuthDecision::Proceed
        }
        DesktopAuthPreflightStatus::TransportError => AppUpdateAutomaticRestartAuthDecision::Defer,
    }
}

fn app_update_emit_auth_restart_blocked(
    app: &AppHandle,
    source: &str,
    error: &str,
    detail: Option<&str>,
) {
    let error = app_update_scrub_external_text(error);
    app_update_store_failed_state(&error);
    app_update_publish_device_state(app, "app_update_auth_restart_blocked");
    let detail = detail
        .map(app_update_scrub_external_text)
        .unwrap_or_default();
    let _ = app.emit(
        APP_UPDATE_STATE_EVENT,
        json!({
            "state": "failed",
            "error": error,
            "detail": detail,
            "source": source,
        }),
    );
    log_terminal_status_event(
        "backend.app_update.auth_restart_blocked",
        json!({
            "source": source,
            "error": error,
            "detail": detail,
        }),
    );
}

async fn app_update_automatic_restart_auth_gate(
    app: &AppHandle,
    source: &str,
) -> Result<(), String> {
    let cloud_mcp_state = app.state::<CloudMcpState>().inner().clone();
    let preflight = desktop_auth_preflight_automatic_restart(app, &cloud_mcp_state).await;
    let transport_deferred_once =
        APP_UPDATE_AUTH_TRANSPORT_RESTART_DEFERRED.load(Ordering::Acquire);
    let decision = app_update_automatic_restart_auth_decision(
        preflight.status,
        crate::daemon_mode_active(),
        transport_deferred_once,
    );

    match decision {
        AppUpdateAutomaticRestartAuthDecision::Proceed => {
            if preflight.status == DesktopAuthPreflightStatus::NoSession
                && APP_UPDATE_AUTH_RESTART_BLOCKED.load(Ordering::Acquire)
            {
                app_update_emit_auth_restart_blocked(
                    app,
                    source,
                    "auth_expired_restart_blocked",
                    Some("Stored desktop session was rejected before restart."),
                );
                return Err("auth_expired_restart_blocked".to_string());
            }
            if preflight.status == DesktopAuthPreflightStatus::AuthOk {
                APP_UPDATE_AUTH_RESTART_BLOCKED.store(false, Ordering::Release);
            }
            if preflight.status == DesktopAuthPreflightStatus::TransportError {
                log_terminal_status_event(
                    "backend.app_update.auth_transport_restart_allowed_after_defer",
                    json!({
                        "source": source,
                        "error": preflight
                            .error
                            .as_deref()
                            .map(app_update_scrub_external_text),
                    }),
                );
            }
            APP_UPDATE_AUTH_TRANSPORT_RESTART_DEFERRED.store(false, Ordering::Release);
            Ok(())
        }
        AppUpdateAutomaticRestartAuthDecision::Block => {
            APP_UPDATE_AUTH_TRANSPORT_RESTART_DEFERRED.store(false, Ordering::Release);
            APP_UPDATE_AUTH_RESTART_BLOCKED.store(true, Ordering::Release);
            app_update_emit_auth_restart_blocked(
                app,
                source,
                "auth_expired_restart_blocked",
                preflight.error.as_deref(),
            );
            Err("auth_expired_restart_blocked".to_string())
        }
        AppUpdateAutomaticRestartAuthDecision::Defer => {
            APP_UPDATE_AUTH_TRANSPORT_RESTART_DEFERRED.store(true, Ordering::Release);
            APP_UPDATE_AUTH_RESTART_BLOCKED.store(false, Ordering::Release);
            app_update_emit_auth_restart_blocked(
                app,
                source,
                "auth_transport_restart_deferred",
                preflight.error.as_deref(),
            );
            Err("auth_transport_restart_deferred".to_string())
        }
    }
}

async fn app_update_install_and_restart_automatic(
    app: AppHandle,
    source: &str,
) -> Result<(), String> {
    app_update_automatic_restart_auth_gate(&app, source).await?;
    app_update_install_and_restart_for_generation(app, None).await
}

async fn app_update_install_and_restart_automatic_for_generation(
    app: AppHandle,
    source: &str,
    generation: u64,
) -> Result<(), String> {
    app_update_automatic_restart_auth_gate(&app, source).await?;
    app_update_install_and_restart_for_generation(app, Some(generation)).await
}

fn app_update_restart_or_exit(app: &AppHandle) {
    if crate::daemon_mode_active() && cfg!(target_os = "linux") {
        log_terminal_status_event(
            "backend.app_update.daemon_exit_for_systemd_restart",
            json!({}),
        );
        app.exit(0);
    } else {
        app.restart();
    }
}

pub(crate) fn app_update_device_payload() -> Value {
    let available = app_update_available_snapshot();
    let staged = app_update_staged_info();
    let available_version = staged
        .as_ref()
        .map(|info| info.version.clone())
        .or_else(|| available.as_ref().map(|info| info.version.clone()));
    let stored_state = APP_UPDATE_STATE.load(Ordering::Acquire);
    let state = if APP_UPDATE_INSTALLING.load(Ordering::Acquire)
        && !matches!(
            stored_state,
            APP_UPDATE_STATE_CHECKING | APP_UPDATE_STATE_DOWNLOADING | APP_UPDATE_STATE_RESTARTING
        ) {
        APP_UPDATE_STATE_RESTARTING
    } else if staged.is_some()
        && !matches!(
            stored_state,
            APP_UPDATE_STATE_CHECKING
                | APP_UPDATE_STATE_DOWNLOADING
                | APP_UPDATE_STATE_RESTARTING
                | APP_UPDATE_STATE_FAILED
        )
    {
        APP_UPDATE_STATE_READY
    } else {
        stored_state
    };
    json!({
        "current_version": env!("CARGO_PKG_VERSION"),
        "available_version": available_version,
        "state": app_update_state_label(state),
        "error": app_update_last_error(),
    })
}

fn app_update_try_begin_download_operation(already_in_progress_error: &str) -> Result<u64, String> {
    let mut operation = APP_UPDATE_REMOTE_OPERATION
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let generation = operation
        .begin_download()
        .ok_or_else(|| already_in_progress_error.to_string())?;
    APP_UPDATE_INSTALLING.store(true, Ordering::Release);
    Ok(generation)
}

fn app_update_try_begin_install_operation(
    expected_generation: Option<u64>,
    already_in_progress_error: &str,
) -> Result<u64, String> {
    let mut operation = APP_UPDATE_REMOTE_OPERATION
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let generation = operation
        .begin_install(expected_generation)
        .ok_or_else(|| already_in_progress_error.to_string())?;
    APP_UPDATE_INSTALLING.store(true, Ordering::Release);
    Ok(generation)
}

fn app_update_mark_restart_pending(generation: u64) -> bool {
    let mut operation = APP_UPDATE_REMOTE_OPERATION
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if !operation.mark_restart_pending(generation) {
        return false;
    }
    APP_UPDATE_INSTALLING.store(false, Ordering::Release);
    true
}

fn app_update_finish_download_operation(generation: u64) -> AppUpdateDownloadFinish {
    let mut operation = APP_UPDATE_REMOTE_OPERATION
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let finish = operation.finish_download(generation);
    if !matches!(finish, AppUpdateDownloadFinish::Stale) {
        APP_UPDATE_INSTALLING.store(false, Ordering::Release);
    }
    finish
}

fn app_update_operation_in_progress_error(error: &str) -> bool {
    error.contains("already in progress")
}

fn app_update_auth_restart_gate_error(error: &str) -> bool {
    matches!(
        error,
        "auth_expired_restart_blocked" | "auth_transport_restart_deferred"
    )
}

fn app_update_persistent_auth_restart_error(error: &str) -> bool {
    error == "auth_expired_restart_blocked"
}

fn app_update_persistent_auth_restart_message() -> &'static str {
    "App update restart was blocked because desktop authentication was rejected. Sign in again, then retry; the downloaded update remains staged."
}

fn app_update_already_running_response(daemon_mode: bool) -> Value {
    json!({
        "ok": true,
        "queued": false,
        "already_running": true,
        "daemon_mode": daemon_mode,
        "auto_restart_when_idle": APP_UPDATE_AUTO_WHEN_IDLE.load(Ordering::Acquire),
        "app_update": app_update_device_payload(),
        "status": app_update_status_snapshot(),
    })
}

fn app_update_committed_terminal_response(daemon_mode: bool, status: &str, message: &str) -> Value {
    let status = status.to_string();
    let message = app_update_scrub_external_text(message);
    let failed = status == "failed";
    json!({
        "ok": !failed,
        "queued": false,
        "terminal_committed": true,
        "terminal_status": status,
        "daemon_mode": daemon_mode,
        "error": if failed { json!(message.clone()) } else { Value::Null },
        "message": message,
        "app_update": app_update_device_payload(),
        "status": app_update_status_snapshot(),
    })
}

fn app_update_remote_restart_queued_response(daemon_mode: bool, newly_queued: bool) -> Value {
    json!({
        "ok": true,
        "daemon_mode": daemon_mode,
        "queued": true,
        "restart_when_idle": true,
        "already_queued": !newly_queued,
        "app_update": app_update_device_payload(),
        "status": app_update_status_snapshot(),
    })
}

fn app_update_remote_restart_gate_response(
    daemon_mode: bool,
    newly_queued: bool,
    error: &str,
) -> Value {
    let clean_error = app_update_scrub_external_text(error);
    json!({
        "ok": false,
        "daemon_mode": daemon_mode,
        "queued": true,
        "restart_when_idle": true,
        "already_queued": !newly_queued,
        "error": clean_error,
        "app_update": app_update_device_payload(),
        "status": app_update_status_snapshot(),
    })
}

async fn app_updater_run_check(app: &AppHandle) -> Result<Option<AppUpdateInfo>, String> {
    app_updater_run_check_with_failure_reporting(
        app,
        AppUpdateCheckFailureReporting::StoreAndPublish,
    )
    .await
}

async fn app_updater_run_background_check(
    app: &AppHandle,
) -> Result<Option<AppUpdateInfo>, String> {
    app_updater_run_check_with_failure_reporting(app, AppUpdateCheckFailureReporting::ReturnOnly)
        .await
}

async fn app_updater_run_check_with_failure_reporting(
    app: &AppHandle,
    failure_reporting: AppUpdateCheckFailureReporting,
) -> Result<Option<AppUpdateInfo>, String> {
    if failure_reporting == AppUpdateCheckFailureReporting::StoreAndPublish {
        app_update_store_state(APP_UPDATE_STATE_CHECKING);
        app_update_publish_device_state(app, "app_update_checking");
    }
    let updater = match app_updater_instance(app) {
        Ok(updater) => updater,
        Err(error) => {
            let error = app_update_scrub_external_text(&error);
            if failure_reporting == AppUpdateCheckFailureReporting::StoreAndPublish {
                app_update_store_failed_state(&error);
                app_update_publish_device_state(app, "app_update_failed");
            }
            return Err(error);
        }
    };
    let update = match updater.check().await {
        Ok(update) => update,
        Err(error) => {
            let error = app_update_scrub_external_text(&format!("Update check failed: {error}"));
            if failure_reporting == AppUpdateCheckFailureReporting::StoreAndPublish {
                app_update_store_failed_state(&error);
                app_update_publish_device_state(app, "app_update_failed");
            }
            return Err(error);
        }
    };
    // Any successful check — background or manual — resets the
    // quiet-first-failure ladder accounting.
    APP_UPDATE_CHECK_NETWORK_FAILURES.store(0, Ordering::Release);
    let Some(update) = update else {
        app_update_store_available(None);
        if app_update_staged_info().is_none() {
            app_update_store_state(APP_UPDATE_STATE_IDLE);
        } else {
            app_update_store_state(APP_UPDATE_STATE_READY);
        }
        app_update_publish_device_state(app, "app_update_idle");
        return Ok(None);
    };
    let info = AppUpdateInfo {
        version: update.version.clone(),
        notes: update.body.clone(),
    };
    app_update_store_available(Some(info.clone()));
    if app_update_staged_info().is_none() {
        app_update_store_state(APP_UPDATE_STATE_IDLE);
    } else {
        app_update_store_state(APP_UPDATE_STATE_READY);
    }
    app_update_publish_device_state(app, "app_update_available");
    let _ = app.emit(
        APP_UPDATE_AVAILABLE_EVENT,
        json!({ "version": info.version, "notes": info.notes }),
    );
    Ok(Some(info))
}

pub(crate) fn app_updater_start(app: &AppHandle) {
    let force_in_debug = std::env::var("DIFFFORGE_UPDATER_FORCE")
        .map(|value| value.trim() == "1")
        .unwrap_or(false);
    if cfg!(debug_assertions) && !force_in_debug {
        return;
    }

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // Check immediately on startup so the update button is present the
        // moment the main window paints (the webview reads app_update_status
        // on mount and also listens for the available event). Subsequent
        // checks fall on the recheck interval at the bottom of the loop.
        loop {
            let pending = match app_updater_run_background_check(&app).await {
                Ok(Some(info)) => {
                    log_terminal_status_event(
                        "backend.app_update.available",
                        json!({ "version": info.version }),
                    );
                    true
                }
                Ok(None) => false,
                Err(error) => {
                    log_terminal_status_event(
                        "backend.app_update.check_failed",
                        json!({ "error": error }),
                    );
                    // The counter is shared so a successful MANUAL check
                    // during our retry sleep resets the accounting before
                    // this failure path runs again.
                    let decision = app_update_check_failure_decision(
                        AppUpdateCheckRetryState {
                            consecutive_network_failures: APP_UPDATE_CHECK_NETWORK_FAILURES
                                .load(Ordering::Acquire),
                        },
                        &error,
                    );
                    APP_UPDATE_CHECK_NETWORK_FAILURES.store(
                        decision.next_state.consecutive_network_failures,
                        Ordering::Release,
                    );
                    if decision.publish_failed_state {
                        app_update_store_failed_state(&error);
                        app_update_publish_device_state(&app, "app_update_failed");
                    }
                    sleep(Duration::from_secs(decision.retry_after_secs)).await;
                    continue;
                }
            };

            if pending {
                app_update_auto_restart_watch(&app).await;
                // Fall through to a fresh check: the watch window either
                // installed (process gone), was disabled mid-wait, or never
                // saw sustained idle within a recheck interval.
                continue;
            }

            sleep(Duration::from_secs(APP_UPDATE_RECHECK_INTERVAL_SECS)).await;
        }
    });
}

/// With an update pending: poll terminal idleness until a full recheck
/// interval elapses, and install once idleness holds across the
/// confirmation pause. Returns without installing when auto-restart is off
/// (plain wait), gets disabled mid-watch, or an install is already running.
async fn app_update_auto_restart_watch(app: &AppHandle) {
    let mut waited: u64 = 0;
    while waited < APP_UPDATE_RECHECK_INTERVAL_SECS {
        if !APP_UPDATE_AUTO_WHEN_IDLE.load(Ordering::Acquire) {
            sleep(Duration::from_secs(
                APP_UPDATE_RECHECK_INTERVAL_SECS - waited,
            ))
            .await;
            return;
        }
        if !APP_UPDATE_INSTALLING.load(Ordering::Acquire)
            && app_update_all_terminals_idle(app).await
        {
            sleep(Duration::from_secs(APP_UPDATE_IDLE_CONFIRM_SECS)).await;
            waited += APP_UPDATE_IDLE_CONFIRM_SECS;
            if APP_UPDATE_AUTO_WHEN_IDLE.load(Ordering::Acquire)
                && app_update_all_terminals_idle(app).await
            {
                log_terminal_status_event("backend.app_update.auto_restart_idle", json!({}));
                // Shares the manual path: installing guard, failure events,
                // and the restart (on success this never returns).
                if let Err(error) =
                    app_update_install_and_restart_automatic(app.clone(), "idle_watcher").await
                {
                    if app_update_operation_in_progress_error(&error) {
                        log_terminal_status_event(
                            "backend.app_update.auto_restart_superseded",
                            json!({}),
                        );
                        return;
                    }
                    log_terminal_status_event(
                        "backend.app_update.auto_restart_failed",
                        json!({ "error": error }),
                    );
                    // Back off before the outer loop re-checks, so a
                    // persistent failure can't turn into a download storm.
                    sleep(Duration::from_secs(APP_UPDATE_IDLE_POLL_SECS)).await;
                    if app_update_auth_restart_gate_error(&error) {
                        continue;
                    }
                    return;
                }
            }
            continue;
        }
        sleep(Duration::from_secs(APP_UPDATE_IDLE_POLL_SECS)).await;
        waited += APP_UPDATE_IDLE_POLL_SECS;
    }
}

#[tauri::command(rename_all = "snake_case")]
fn app_update_status() -> Value {
    app_update_status_snapshot()
}

#[tauri::command(rename_all = "snake_case")]
fn app_update_settings_state() -> Value {
    app_update_settings_to_value()
}

#[tauri::command(rename_all = "snake_case")]
async fn app_update_settings_update(
    app: AppHandle,
    auto_restart_when_idle: bool,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app_update_settings_save(&app, auto_restart_when_idle)
    })
    .await
    .map_err(|error| format!("App update settings worker failed: {error}"))?
}

#[tauri::command(rename_all = "snake_case")]
async fn app_update_check_now(app: AppHandle) -> Result<Value, String> {
    app_updater_run_check(&app).await?;
    Ok(app_update_status_snapshot())
}

#[tauri::command(rename_all = "snake_case")]
async fn app_update_install_and_restart(app: AppHandle) -> Result<(), String> {
    app_update_install_and_restart_for_generation(app, None).await
}

async fn app_update_install_and_restart_for_generation(
    app: AppHandle,
    expected_generation: Option<u64>,
) -> Result<(), String> {
    let generation = app_update_try_begin_install_operation(
        expected_generation,
        "An update install is already in progress.",
    )?;
    let result = app_update_install_inner(&app, generation)
        .await
        .map_err(|error| app_update_scrub_external_text(&error));
    if let Err(error) = &result {
        app_update_store_failed_state(error);
        app_update_publish_device_state(&app, "app_update_failed");
        let _ = app.emit(
            APP_UPDATE_STATE_EVENT,
            json!({ "state": "failed", "error": error }),
        );
        log_terminal_status_event(
            "backend.app_update.install_failed",
            json!({ "error": error }),
        );
        app_update_notify_remote_command_terminal(
            generation,
            "failed",
            &format!("App update failed on this desktop: {error}"),
        )
        .await;
    }
    result
}

#[tauri::command(rename_all = "snake_case")]
async fn app_update_download(app: AppHandle) -> Result<Value, String> {
    let generation =
        app_update_try_begin_download_operation("An update download is already in progress.")?;
    app_update_download_for_generation(app, generation).await
}

async fn app_update_download_for_generation(
    app: AppHandle,
    generation: u64,
) -> Result<Value, String> {
    let result = app_update_download_inner(&app)
        .await
        .map_err(|error| app_update_scrub_external_text(&error));
    if let Err(error) = &result {
        app_update_store_failed_state(error);
        app_update_publish_device_state(&app, "app_update_failed");
        let _ = app.emit(
            APP_UPDATE_STATE_EVENT,
            json!({ "state": "failed", "error": error }),
        );
        log_terminal_status_event(
            "backend.app_update.download_failed",
            json!({ "error": error }),
        );
        if error.contains("No update is available") {
            app_update_notify_remote_command_terminal(
                generation,
                "completed",
                "No update is available.",
            )
            .await;
        } else {
            app_update_notify_remote_command_terminal(
                generation,
                "failed",
                &format!("App update failed on this desktop: {error}"),
            )
            .await;
        }
    } else {
        match app_update_finish_download_operation(generation) {
            AppUpdateDownloadFinish::RestartPending(generation) => {
                app_update_spawn_remote_restart_when_idle(app.clone(), generation);
            }
            AppUpdateDownloadFinish::Finished | AppUpdateDownloadFinish::Stale => {}
        }
    }
    result
}

#[tauri::command(rename_all = "snake_case")]
async fn app_update_restart(app: AppHandle) -> Result<(), String> {
    let generation = app_update_try_begin_install_operation(
        None,
        "An update operation is already in progress.",
    )?;
    let result = app_update_restart_inner(&app, generation)
        .await
        .map_err(|error| app_update_scrub_external_text(&error));
    if let Err(error) = &result {
        app_update_store_failed_state(error);
        app_update_publish_device_state(&app, "app_update_failed");
        let _ = app.emit(
            APP_UPDATE_STATE_EVENT,
            json!({ "state": "failed", "error": error }),
        );
        log_terminal_status_event(
            "backend.app_update.restart_failed",
            json!({ "error": error }),
        );
        app_update_notify_remote_command_terminal(
            generation,
            "failed",
            &format!("App update failed on this desktop: {error}"),
        )
        .await;
    }
    result
}

pub(crate) async fn app_update_remote_now(
    app: AppHandle,
    binding: AppUpdateRemoteCommandBinding,
) -> Value {
    let daemon_mode = crate::daemon_mode_active();
    if binding.phase == AppUpdateOperationPhaseKind::Terminal {
        let terminal = app_update_notify_bound_remote_command_terminal(binding).await;
        return terminal.map_or_else(
            || {
                app_update_committed_terminal_response(
                    daemon_mode,
                    "completed",
                    "App update operation finished on this desktop.",
                )
            },
            |terminal| {
                app_update_committed_terminal_response(
                    daemon_mode,
                    &terminal.status,
                    &terminal.message,
                )
            },
        );
    }
    if !app_update_remote_command_context_is_bound(binding) {
        return app_update_committed_terminal_response(
            daemon_mode,
            "completed",
            "App update operation finished on this desktop.",
        );
    }

    if !binding.started_new {
        if binding.phase != AppUpdateOperationPhaseKind::RestartPending {
            return app_update_already_running_response(daemon_mode);
        }

        if let Err(error) =
            app_update_automatic_restart_auth_gate(&app, "remote_app_update_now_ack").await
        {
            if app_update_persistent_auth_restart_error(&error) {
                let message = app_update_persistent_auth_restart_message();
                if !app_update_notify_restart_pending_auth_rejection(binding.generation).await {
                    return app_update_already_running_response(daemon_mode);
                }
                return app_update_committed_terminal_response(daemon_mode, "failed", message);
            }
            return app_update_remote_restart_gate_response(daemon_mode, false, &error);
        }
        return match app_update_install_and_restart_for_generation(
            app.clone(),
            Some(binding.generation),
        )
        .await
        {
            Ok(()) => app_update_committed_terminal_response(
                daemon_mode,
                "completed",
                "App update installed; restarting now.",
            ),
            Err(error) if app_update_operation_in_progress_error(&error) => {
                app_update_already_running_response(daemon_mode)
            }
            Err(error) => app_update_committed_terminal_response(
                daemon_mode,
                "failed",
                &format!("App update failed on this desktop: {error}"),
            ),
        };
    }

    if app_update_staged_info().is_some() {
        // A remote "update now" on an already-staged update must actually restart to
        // apply it — on GUI desktops too, not only headless/daemon devices. The remote
        // restart button was a no-op in GUI mode before. Restart-when-idle avoids
        // interrupting active work, and the auth gate still applies.
        let gate_result =
            app_update_automatic_restart_auth_gate(&app, "remote_app_update_now_ack").await;
        if let Err(error) = gate_result {
            let clean_error = app_update_scrub_external_text(&error);
            let message = if app_update_persistent_auth_restart_error(&error) {
                app_update_persistent_auth_restart_message().to_string()
            } else {
                format!("App update failed on this desktop: {clean_error}")
            };
            app_update_notify_remote_command_terminal(binding.generation, "failed", &message).await;
            return app_update_committed_terminal_response(daemon_mode, "failed", &message);
        }
        if !app_update_mark_restart_pending(binding.generation) {
            return app_update_committed_terminal_response(
                daemon_mode,
                "completed",
                "App update operation finished on this desktop.",
            );
        }
        let newly_queued =
            app_update_spawn_remote_restart_when_idle(app.clone(), binding.generation);
        return app_update_remote_restart_queued_response(daemon_mode, newly_queued);
    }

    // On Linux/macOS the download path installs in place (`app_update_download`
    // ends in `update.install`), so run the restart-auth gate BEFORE the
    // mutation: a sticky auth rejection after installing would strand the box
    // with the new binary on disk and the old process running forever.
    if let Err(error) = app_update_automatic_restart_auth_gate(&app, "remote_app_update_now").await
    {
        let clean_error = app_update_scrub_external_text(&error);
        app_update_notify_remote_command_terminal(
            binding.generation,
            "failed",
            &format!("App update failed on this desktop: {clean_error}"),
        )
        .await;
        return app_update_committed_terminal_response(
            daemon_mode,
            "failed",
            &format!("App update failed on this desktop: {clean_error}"),
        );
    }

    let download_result = app_update_download_for_generation(app.clone(), binding.generation).await;

    match download_result {
        Ok(_) => app_update_remote_restart_queued_response(daemon_mode, true),
        Err(error) => {
            let no_update = error.contains("No update is available");
            if no_update {
                app_update_store_state(APP_UPDATE_STATE_IDLE);
            }
            let clean_error = app_update_scrub_external_text(&error);
            if no_update {
                app_update_committed_terminal_response(
                    daemon_mode,
                    "completed",
                    "No update is available.",
                )
            } else {
                app_update_committed_terminal_response(
                    daemon_mode,
                    "failed",
                    &format!("App update failed on this desktop: {clean_error}"),
                )
            }
        }
    }
}

pub(crate) fn app_update_bind_remote_command_context(
    state: &CloudMcpState,
    event: &Value,
) -> Option<AppUpdateRemoteCommandBinding> {
    // The owner restart takes this lock exclusively only after the terminal
    // generation is drained. A command that gets past this read lock is
    // guaranteed to attach before that final close-and-exit barrier.
    if APP_UPDATE_REMOTE_ADMISSION_CLOSED.load(Ordering::Acquire) {
        return None;
    }
    let _admission = APP_UPDATE_REMOTE_ADMISSION
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if APP_UPDATE_REMOTE_ADMISSION_CLOSED.load(Ordering::Acquire) {
        return None;
    }
    let token = APP_UPDATE_REMOTE_COMMAND_TOKEN.fetch_add(1, Ordering::AcqRel) + 1;
    let mut operation = APP_UPDATE_REMOTE_OPERATION
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let binding = operation.bind(AppUpdateRemoteCommandContext {
        token,
        state: state.clone(),
        event: event.clone(),
        reply: AppUpdateRemoteReplyState::Pending,
    });
    if binding.started_new {
        APP_UPDATE_INSTALLING.store(true, Ordering::Release);
    }
    Some(binding)
}

pub(crate) fn app_update_release_remote_command_context(
    binding: AppUpdateRemoteCommandBinding,
) -> bool {
    let mut operation = APP_UPDATE_REMOTE_OPERATION
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let released = operation.release(binding);
    if released && operation.phase == AppUpdateOperationPhase::Idle {
        APP_UPDATE_INSTALLING.store(false, Ordering::Release);
    }
    released
}

pub(crate) fn app_update_remote_command_context_is_bound(
    binding: AppUpdateRemoteCommandBinding,
) -> bool {
    let operation = APP_UPDATE_REMOTE_OPERATION
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    operation.contains(binding)
}

fn app_update_commit_remote_command_terminal(
    generation: u64,
    status: &str,
    message: &str,
    advance_when_drained: bool,
) -> Option<AppUpdateTerminalDelivery> {
    let terminal = AppUpdateRemoteTerminalStatus {
        status: status.to_string(),
        message: app_update_scrub_external_text(message),
    };
    let mut operation = APP_UPDATE_REMOTE_OPERATION
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let delivery = operation.commit_terminal(generation, terminal, advance_when_drained);
    if delivery.is_some() && operation.phase == AppUpdateOperationPhase::Idle {
        APP_UPDATE_INSTALLING.store(false, Ordering::Release);
    }
    delivery
}

fn app_update_finish_remote_terminal_delivery_attempt(
    generation: u64,
    token: u64,
    attempts: usize,
    confirmed: bool,
    delivery_before_exit: bool,
) -> AppUpdateTerminalAttemptOutcome {
    let mut operation = APP_UPDATE_REMOTE_OPERATION
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let outcome = operation.finish_terminal_delivery_attempt(
        generation,
        token,
        attempts,
        confirmed,
        delivery_before_exit,
    );
    if operation.phase == AppUpdateOperationPhase::Idle {
        APP_UPDATE_INSTALLING.store(false, Ordering::Release);
    }
    outcome
}

fn app_update_exit_terminal_delivery_can_release(attempts: usize, confirmed: bool) -> bool {
    confirmed || attempts >= APP_UPDATE_EXIT_TERMINAL_DELIVERY_ATTEMPTS
}

async fn app_update_send_terminal_context(
    generation: u64,
    context: AppUpdateRemoteCommandContext,
    terminal: AppUpdateRemoteTerminalStatus,
    before_exit: bool,
) {
    let mut attempts = 0;
    let mut confirmed = false;
    let mut last_error = None;
    let effective_before_exit = loop {
        attempts += 1;
        match cloud_mcp_send_app_update_remote_command_status_event(
            &context.state,
            &context.event,
            &terminal.status,
            &terminal.message,
            None,
        )
        .await
        {
            Ok(_) => confirmed = true,
            Err(error) => last_error = Some(app_update_scrub_external_text(&error)),
        }
        let outcome = app_update_finish_remote_terminal_delivery_attempt(
            generation,
            context.token,
            attempts,
            confirmed,
            before_exit,
        );
        if !outcome.retry {
            break outcome.before_exit;
        }
        sleep(Duration::from_millis(
            APP_UPDATE_EXIT_TERMINAL_DELIVERY_RETRY_MS,
        ))
        .await;
    };
    if effective_before_exit && !confirmed {
        let error = last_error.unwrap_or_else(|| {
            "Neither live delivery nor durable persistence was confirmed.".to_string()
        });
        log_terminal_status_event(
            "backend.app_update.terminal_delivery_lost_before_exit",
            json!({
                "attempts": attempts,
                "command_id": context.event.get("command_id").and_then(Value::as_str),
                "error": error,
                "generation": generation,
                "status": terminal.status,
            }),
        );
        if crate::daemon_mode_active() {
            eprintln!(
                "App update terminal status was lost before daemon restart after {attempts} attempts: {error}"
            );
        }
    }
}

async fn app_update_send_terminal_delivery(generation: u64, delivery: AppUpdateTerminalDelivery) {
    let AppUpdateTerminalDelivery {
        contexts,
        terminal,
        before_exit,
    } = delivery;
    let deliveries = contexts.into_iter().map(|context| {
        app_update_send_terminal_context(generation, context, terminal.clone(), before_exit)
    });
    futures_util::future::join_all(deliveries).await;
}

async fn app_update_notify_bound_remote_command_terminal(
    binding: AppUpdateRemoteCommandBinding,
) -> Option<AppUpdateRemoteTerminalStatus> {
    let delivery = {
        let mut operation = APP_UPDATE_REMOTE_OPERATION
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        operation.claim_bound_terminal(binding)
    }?;
    let terminal = delivery.terminal.clone();
    app_update_send_terminal_delivery(binding.generation, delivery).await;
    Some(terminal)
}

/// Sends a queued acknowledgement without allowing it to overtake the
/// operation's terminal. If the terminal commits while this send is in
/// flight, this command sends that terminal immediately after the queued
/// acknowledgement and only then releases its attachment.
pub(crate) async fn app_update_send_remote_command_nonterminal(
    binding: AppUpdateRemoteCommandBinding,
    status: &str,
    message: &str,
    details: Option<&Value>,
) -> bool {
    let context = {
        let mut operation = APP_UPDATE_REMOTE_OPERATION
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        operation.begin_nonterminal_reply(binding)
    };
    let Some(context) = context else {
        return false;
    };
    if !crate::app_shutdown_requested() {
        let clean_message = app_update_scrub_external_text(message);
        let _ = cloud_mcp_send_app_update_remote_command_nonterminal_status_event(
            &context.state,
            &context.event,
            status,
            &clean_message,
            details,
        )
        .await;
    }
    let terminal = {
        let mut operation = APP_UPDATE_REMOTE_OPERATION
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        operation.finish_nonterminal_reply(binding)
    };
    if let Some(terminal) = terminal {
        app_update_send_terminal_delivery(binding.generation, terminal).await;
    }
    true
}

/// Commits one generation exactly once, then sends the same terminal outcome
/// to every remote command that attached while that operation was live.
async fn app_update_notify_remote_command_terminal(
    generation: u64,
    status: &str,
    message: &str,
) -> bool {
    let Some(delivery) =
        app_update_commit_remote_command_terminal(generation, status, message, true)
    else {
        // A late finisher from an older generation must not answer or clear
        // the operation that replaced it.
        return false;
    };
    app_update_send_terminal_delivery(generation, delivery).await;
    true
}

async fn app_update_notify_restart_pending_auth_rejection(generation: u64) -> bool {
    let terminal = AppUpdateRemoteTerminalStatus {
        status: "failed".to_string(),
        message: app_update_persistent_auth_restart_message().to_string(),
    };
    let delivery = {
        let mut operation = APP_UPDATE_REMOTE_OPERATION
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        operation.commit_restart_pending_terminal(generation, terminal)
    };
    let Some(delivery) = delivery else {
        return false;
    };
    app_update_send_terminal_delivery(generation, delivery).await;
    true
}

/// Commits a successful install/restart without reopening the operation slot.
/// Late commands attach to this terminal generation and receive the same
/// completed outcome instead of starting an update that the owner restart
/// would abandon.
async fn app_update_notify_remote_command_terminal_before_restart(
    generation: u64,
    status: &str,
    message: &str,
) -> bool {
    // Fence admission before committing. Commands admitted before this write
    // lock have already attached; commands after it cannot create an orphaned
    // generation while this process is preparing to exit.
    let admission = APP_UPDATE_REMOTE_ADMISSION
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    APP_UPDATE_REMOTE_ADMISSION_CLOSED.store(true, Ordering::Release);
    let Some(mut delivery) =
        app_update_commit_remote_command_terminal(generation, status, message, false)
    else {
        drop(admission);
        app_update_drain_current_remote_generation_before_exit(
            "Desktop app is restarting before this update command completed.",
        )
        .await;
        return false;
    };
    let pending = {
        let mut operation = APP_UPDATE_REMOTE_OPERATION
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        operation.claim_pending_terminal_delivery(generation, true)
    };
    if let Some(mut pending) = pending {
        delivery.contexts.append(&mut pending.contexts);
    }
    drop(admission);
    app_update_send_terminal_delivery(generation, delivery).await;
    app_update_wait_for_terminal_generation_drain(generation).await;
    true
}

async fn app_update_wait_for_terminal_generation_drain(generation: u64) {
    loop {
        let drained = {
            let operation = APP_UPDATE_REMOTE_OPERATION
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            operation.generation != generation
                || !matches!(&operation.phase, AppUpdateOperationPhase::Terminal { .. })
                || operation.attached.is_empty()
        };
        if drained {
            break;
        }
        sleep(Duration::from_millis(10)).await;
    }
}

async fn app_update_drain_current_remote_generation_before_exit(message: &str) {
    let terminal = AppUpdateRemoteTerminalStatus {
        status: "failed".to_string(),
        message: message.to_string(),
    };
    let (generation, delivery) = {
        let mut operation = APP_UPDATE_REMOTE_OPERATION
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let generation = operation.active_generation();
        let delivery = operation
            .commit_shutdown_terminal(terminal)
            .map(|(_, delivery)| delivery)
            .or_else(|| {
                generation.and_then(|generation| {
                    operation.claim_pending_terminal_delivery(generation, true)
                })
            });
        (generation, delivery)
    };
    let Some(generation) = generation else {
        return;
    };
    if let Some(delivery) = delivery {
        app_update_send_terminal_delivery(generation, delivery).await;
    }
    loop {
        let drained = {
            let mut operation = APP_UPDATE_REMOTE_OPERATION
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            operation.generation != generation || operation.finish_shutdown_drain(generation)
        };
        if drained {
            break;
        }
        sleep(Duration::from_millis(10)).await;
    }
    APP_UPDATE_INSTALLING.store(false, Ordering::Release);
}

pub(crate) async fn app_update_shutdown() {
    let admission = APP_UPDATE_REMOTE_ADMISSION
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    APP_UPDATE_REMOTE_ADMISSION_CLOSED.store(true, Ordering::Release);
    let terminal = AppUpdateRemoteTerminalStatus {
        status: "failed".to_string(),
        message: "Desktop app is shutting down before the update completed.".to_string(),
    };
    let (generation, delivery) = {
        let mut operation = APP_UPDATE_REMOTE_OPERATION
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let generation = operation.active_generation();
        let delivery = operation
            .commit_shutdown_terminal(terminal)
            .map(|(_, delivery)| delivery)
            .or_else(|| {
                generation.and_then(|generation| {
                    operation.claim_pending_terminal_delivery(generation, true)
                })
            });
        (generation, delivery)
    };
    drop(admission);
    if let Some(generation) = generation {
        if let Some(delivery) = delivery {
            app_update_send_terminal_delivery(generation, delivery).await;
        }
        loop {
            let drained = {
                let mut operation = APP_UPDATE_REMOTE_OPERATION
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                operation.generation != generation || operation.finish_shutdown_drain(generation)
            };
            if drained {
                break;
            }
            sleep(Duration::from_millis(10)).await;
        }
        APP_UPDATE_INSTALLING.store(false, Ordering::Release);
        log_terminal_status_event(
            "backend.app_update.shutdown_drained",
            json!({ "generation": generation }),
        );
    }
}

fn app_update_finish_restart_watcher(generation: u64) {
    let mut operation = APP_UPDATE_REMOTE_OPERATION
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    operation.finish_restart_watcher(generation);
}

fn app_update_spawn_remote_restart_when_idle(app: AppHandle, generation: u64) -> bool {
    {
        let mut operation = APP_UPDATE_REMOTE_OPERATION
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if !operation.claim_restart_watcher(generation) {
            return false;
        }
    }
    log_terminal_status_event(
        "backend.app_update.remote_restart_queued",
        json!({ "generation": generation }),
    );
    tauri::async_runtime::spawn(async move {
        app_update_remote_restart_when_idle(app, generation).await;
        app_update_finish_restart_watcher(generation);
    });
    true
}

async fn app_update_remote_restart_when_idle(app: AppHandle, generation: u64) {
    loop {
        if crate::app_shutdown_requested() {
            return;
        }
        if !APP_UPDATE_INSTALLING.load(Ordering::Acquire)
            && app_update_all_terminals_idle(&app).await
        {
            sleep(Duration::from_secs(APP_UPDATE_IDLE_CONFIRM_SECS)).await;
            if crate::app_shutdown_requested() {
                return;
            }
            if app_update_all_terminals_idle(&app).await {
                let result = app_update_install_and_restart_automatic_for_generation(
                    app.clone(),
                    "remote_app_update_now",
                    generation,
                )
                .await;
                if let Err(error) = result {
                    if app_update_operation_in_progress_error(&error) {
                        log_terminal_status_event(
                            "backend.app_update.remote_restart_superseded",
                            json!({}),
                        );
                        return;
                    }
                    log_terminal_status_event(
                        "backend.app_update.remote_restart_failed",
                        json!({ "error": app_update_scrub_external_text(&error) }),
                    );
                    if app_update_persistent_auth_restart_error(&error) {
                        app_update_notify_restart_pending_auth_rejection(generation).await;
                        return;
                    }
                    if app_update_auth_restart_gate_error(&error) {
                        sleep(Duration::from_secs(APP_UPDATE_IDLE_POLL_SECS)).await;
                        continue;
                    }
                    // The operation owner resolved every attached command
                    // before advancing the generation.
                }
                return;
            }
        }
        sleep(Duration::from_secs(APP_UPDATE_IDLE_POLL_SECS)).await;
    }
}

async fn app_update_download_inner(app: &AppHandle) -> Result<Value, String> {
    app_update_store_state(APP_UPDATE_STATE_CHECKING);
    app_update_publish_device_state(app, "app_update_checking");
    let updater = app_updater_instance(app)?;
    let update = updater
        .check()
        .await
        .map_err(|error| format!("Update check failed: {error}"))?
        .ok_or_else(|| "No update is available.".to_string())?;
    let info = AppUpdateInfo {
        version: update.version.clone(),
        notes: update.body.clone(),
    };
    app_update_store_available(Some(info));
    app_update_store_staged(None);

    let _ = app.emit(
        APP_UPDATE_STATE_EVENT,
        json!({ "state": "downloading", "version": update.version }),
    );
    app_update_store_state(APP_UPDATE_STATE_DOWNLOADING);
    app_update_publish_device_state(app, "app_update_downloading");
    log_terminal_status_event(
        "backend.app_update.download_started",
        json!({ "version": update.version }),
    );

    let version = update.version.clone();
    let bytes = app_update_download_bytes(app, &update).await?;

    #[cfg(windows)]
    {
        app_update_store_staged(Some(AppUpdateStaged {
            version: version.clone(),
            installed: false,
            bytes: Some(bytes),
        }));
        app_update_store_state(APP_UPDATE_STATE_READY);
        app_update_publish_device_state(app, "app_update_ready");
        let _ = app.emit(
            APP_UPDATE_STATE_EVENT,
            json!({ "state": "ready", "version": version, "installed": false }),
        );
        log_terminal_status_event("backend.app_update.downloaded", json!({}));
        Ok(app_update_status_snapshot())
    }

    #[cfg(not(windows))]
    {
        update
            .install(&bytes)
            .map_err(|error| format!("Update install failed: {error}"))?;
        app_update_store_staged(Some(AppUpdateStaged {
            version: version.clone(),
            installed: true,
            bytes: None,
        }));
        app_update_store_state(APP_UPDATE_STATE_READY);
        app_update_publish_device_state(app, "app_update_ready");
        let _ = app.emit(
            APP_UPDATE_STATE_EVENT,
            json!({ "state": "ready", "version": version, "installed": true }),
        );
        log_terminal_status_event("backend.app_update.staged", json!({}));
        Ok(app_update_status_snapshot())
    }
}

async fn app_update_install_inner(app: &AppHandle, generation: u64) -> Result<(), String> {
    if app_update_staged_info().is_some() {
        return app_update_restart_inner(app, generation).await;
    }

    app_update_store_state(APP_UPDATE_STATE_CHECKING);
    app_update_publish_device_state(app, "app_update_checking");
    let updater = app_updater_instance(app)?;
    let update = updater
        .check()
        .await
        .map_err(|error| format!("Update check failed: {error}"))?
        .ok_or_else(|| "No update is available.".to_string())?;

    let _ = app.emit(
        APP_UPDATE_STATE_EVENT,
        json!({ "state": "downloading", "version": update.version }),
    );
    app_update_store_state(APP_UPDATE_STATE_DOWNLOADING);
    app_update_publish_device_state(app, "app_update_downloading");
    log_terminal_status_event(
        "backend.app_update.install_started",
        json!({ "version": update.version }),
    );

    #[cfg(windows)]
    let version = update.version.clone();
    let bytes = app_update_download_bytes(app, &update).await?;

    #[cfg(windows)]
    app_update_launch_windows_nsis(app, &version, &bytes)?;

    #[cfg(not(windows))]
    update
        .install(bytes)
        .map_err(|error| format!("Update install failed: {error}"))?;

    // On Windows the validated NSIS launch takes over; on macOS/Linux the
    // swapped bundle only takes effect after this relaunch.
    app_update_store_state(APP_UPDATE_STATE_RESTARTING);
    app_update_publish_device_state_now(app, "app_update_restarting").await;
    let _ = app.emit(APP_UPDATE_STATE_EVENT, json!({ "state": "restarting" }));
    log_terminal_status_event("backend.app_update.installed", json!({}));
    // Resolve every admitted remote command before the process goes away.
    app_update_notify_remote_command_terminal_before_restart(
        generation,
        "completed",
        "App update installed; restarting now.",
    )
    .await;

    #[cfg(windows)]
    {
        app.cleanup_before_exit();
        std::process::exit(0);
    }

    #[cfg(not(windows))]
    app_update_restart_or_exit(app);
    #[allow(unreachable_code)]
    Ok(())
}

async fn app_update_download_bytes(
    app: &AppHandle,
    update: &tauri_plugin_updater::Update,
) -> Result<Vec<u8>, String> {
    let progress_app = app.clone();
    let mut downloaded: u64 = 0;
    let mut next_progress: u64 = APP_UPDATE_PROGRESS_STEP_BYTES;
    update
        .download(
            move |chunk, total| {
                downloaded += chunk as u64;
                if downloaded >= next_progress || Some(downloaded) == total {
                    while next_progress <= downloaded {
                        next_progress += APP_UPDATE_PROGRESS_STEP_BYTES;
                    }
                    let _ = progress_app.emit(
                        APP_UPDATE_PROGRESS_EVENT,
                        json!({ "downloaded": downloaded, "total": total }),
                    );
                }
            },
            || {},
        )
        .await
        .map_err(|error| format!("Update download failed: {error}"))
}

#[cfg(windows)]
fn app_update_escape_nsis_current_exe_arg(arg: &std::ffi::OsStr) -> String {
    // Kept byte-for-byte equivalent to tauri-plugin-updater 2.10.1's NSIS
    // escaping, including escaping `/` so it cannot become an NSIS switch.
    let arg = arg.to_string_lossy();
    let mut command = Vec::new();
    let quote = arg
        .chars()
        .any(|character| character == ' ' || character == '\t' || character == '/')
        || arg.is_empty();
    if quote {
        command.push('"');
    }
    let mut backslashes = 0;
    for character in arg.chars() {
        if character == '\\' {
            backslashes += 1;
        } else {
            if character == '"' {
                command.extend((0..=backslashes).map(|_| '\\'));
            }
            backslashes = 0;
        }
        command.push(character);
    }
    if quote {
        command.extend((0..backslashes).map(|_| '\\'));
        command.push('"');
    }
    command.into_iter().collect()
}

#[cfg(windows)]
fn app_update_windows_wide(value: &std::ffi::OsStr) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;

    value.encode_wide().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
struct AppUpdatePreparedWindowsInstaller {
    temp_dir: std::path::PathBuf,
    installer_path: Option<std::path::PathBuf>,
    persist: bool,
}

#[cfg(windows)]
impl AppUpdatePreparedWindowsInstaller {
    fn new(temp_dir: std::path::PathBuf) -> Self {
        Self {
            temp_dir,
            installer_path: None,
            persist: false,
        }
    }

    fn installer_path(&self) -> &std::path::Path {
        self.installer_path
            .as_deref()
            .expect("prepared Windows installer must have a path")
    }

    fn persist(mut self) {
        self.persist = true;
    }
}

#[cfg(windows)]
impl Drop for AppUpdatePreparedWindowsInstaller {
    fn drop(&mut self) {
        if !self.persist {
            let _ = std::fs::remove_dir_all(&self.temp_dir);
        }
    }
}

#[cfg(windows)]
fn app_update_sweep_stale_windows_installer_dirs(temp_root: &std::path::Path, prefix: &str) {
    let Ok(entries) = std::fs::read_dir(temp_root) else {
        return;
    };
    for entry in entries.flatten() {
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();
        let Some(uuid) = file_name.strip_prefix(prefix) else {
            continue;
        };
        if uuid::Uuid::parse_str(uuid).is_err()
            || !entry.file_type().is_ok_and(|file_type| file_type.is_dir())
        {
            continue;
        }
        let _ = std::fs::remove_dir_all(entry.path());
    }
}

#[cfg(windows)]
fn app_update_prepare_windows_nsis_installer(
    app: &AppHandle,
    version: &str,
    bytes: &[u8],
) -> Result<AppUpdatePreparedWindowsInstaller, String> {
    use std::io::Write;

    let app_name = &app.package_info().name;
    // The plugin uses `{app}-{version}-updater-*` below the system temp dir
    // and intentionally keeps it across process exit so the launched
    // installer remains available. Use the same lifetime and naming shape.
    let temp_root = std::env::temp_dir();
    let prefix = format!("{app_name}-{version}-updater-");
    app_update_sweep_stale_windows_installer_dirs(&temp_root, &prefix);
    let temp_dir = temp_root.join(format!("{prefix}{}", uuid::Uuid::new_v4()));
    let mut prepared = AppUpdatePreparedWindowsInstaller::new(temp_dir.clone());
    std::fs::create_dir_all(&temp_dir)
        .map_err(|error| format!("Could not create Windows updater temp directory: {error}"))?;

    if bytes.starts_with(b"PK\x03\x04")
        || bytes.starts_with(b"PK\x05\x06")
        || bytes.starts_with(b"PK\x07\x08")
    {
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))
            .map_err(|error| format!("Could not open Windows updater archive: {error}"))?;
        archive
            .extract(&temp_dir)
            .map_err(|error| format!("Could not extract Windows updater archive: {error}"))?;
        for entry in std::fs::read_dir(&temp_dir)
            .map_err(|error| format!("Could not inspect Windows updater archive: {error}"))?
        {
            let path = entry
                .map_err(|error| format!("Could not inspect Windows updater file: {error}"))?
                .path();
            if path.extension() == Some(std::ffi::OsStr::new("exe")) {
                prepared.installer_path = Some(path);
                return Ok(prepared);
            }
        }
        return Err("Windows updater archive did not contain an NSIS installer.".to_string());
    }

    if !bytes.starts_with(b"MZ") {
        return Err("Windows updater payload is not a valid NSIS installer.".to_string());
    }
    let installer_path = temp_dir.join(format!("{app_name}-{version}-installer.exe"));
    let mut installer = std::fs::File::create(&installer_path)
        .map_err(|error| format!("Could not create Windows updater installer: {error}"))?;
    installer
        .write_all(bytes)
        .map_err(|error| format!("Could not persist Windows updater installer: {error}"))?;
    prepared.installer_path = Some(installer_path);
    Ok(prepared)
}

#[cfg(windows)]
fn app_update_launch_windows_nsis(
    app: &AppHandle,
    version: &str,
    bytes: &[u8],
) -> Result<(), String> {
    use std::ffi::{OsStr, OsString};
    use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOW};

    let prepared = app_update_prepare_windows_nsis_installer(app, version, bytes)?;
    // The updater config has no Windows override, so 2.10.1 uses its default
    // passive NSIS mode. Preserve its exact managed switches and current-exe
    // arguments, with no app-specific installer arguments configured.
    let mut installer_args = vec![
        OsString::from("/P"),
        OsString::from("/R"),
        OsString::from("/UPDATE"),
        OsString::from("/ARGS"),
    ];
    let current_exe_args = app.env().args_os;
    installer_args.extend(
        current_exe_args
            .iter()
            .skip(1)
            .map(|arg| OsString::from(app_update_escape_nsis_current_exe_arg(arg))),
    );
    let mut parameters = OsString::new();
    for (index, argument) in installer_args.iter().enumerate() {
        if index > 0 {
            parameters.push(" ");
        }
        parameters.push(argument);
    }

    let verb = app_update_windows_wide(OsStr::new("open"));
    let file = app_update_windows_wide(prepared.installer_path().as_os_str());
    let parameters = app_update_windows_wide(&parameters);
    let launch_result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            file.as_ptr(),
            parameters.as_ptr(),
            std::ptr::null(),
            SW_SHOW,
        )
    } as isize;
    if launch_result <= 32 {
        return Err(format!(
            "Windows updater installer launch failed with ShellExecuteW code {launch_result}."
        ));
    }
    prepared.persist();
    Ok(())
}

async fn app_update_restart_inner(app: &AppHandle, generation: u64) -> Result<(), String> {
    let staged = app_update_staged_for_restart()
        .ok_or_else(|| "No downloaded update is ready.".to_string())?;
    app_update_store_state(APP_UPDATE_STATE_RESTARTING);
    app_update_publish_device_state_now(app, "app_update_restarting").await;
    let _ = app.emit(
        APP_UPDATE_STATE_EVENT,
        json!({ "state": "restarting", "version": staged.version }),
    );

    #[cfg(windows)]
    {
        let bytes = staged.bytes.ok_or_else(|| {
            "Downloaded update bytes are missing. Click Update to download it again.".to_string()
        })?;
        log_terminal_status_event("backend.app_update.restart_installing", json!({}));
        app_update_launch_windows_nsis(app, &staged.version, &bytes)?;
        app_update_notify_remote_command_terminal_before_restart(
            generation,
            "completed",
            "App update installed; restarting now.",
        )
        .await;
        app.cleanup_before_exit();
        std::process::exit(0);
    }

    #[cfg(not(windows))]
    {
        if !staged.installed {
            return Err(
                "Downloaded update is not installed yet. Click Update to download it again."
                    .to_string(),
            );
        }
        log_terminal_status_event("backend.app_update.restarting", json!({}));
    }
    // Resolve every admitted remote command before the process goes away.
    app_update_notify_remote_command_terminal_before_restart(
        generation,
        "completed",
        "App update installed; restarting now.",
    )
    .await;
    app_update_restart_or_exit(app);
    #[allow(unreachable_code)]
    Ok(())
}

#[cfg(test)]
mod app_update_tests {
    use super::*;

    #[test]
    fn external_text_scrubs_url_credentials_queries_and_fragments() {
        assert_eq!(
            app_update_scrub_external_text(
                "request to https://user:password@updates.example/latest.json?token=SECRET#trace failed; mirror=http://mirror.example/feed?key=HIDDEN"
            ),
            "request to https://updates.example/latest.json failed; mirror=http://mirror.example/feed"
        );
        assert_eq!(
            app_update_scrub_external_text("plain updater error without a URL"),
            "plain updater error without a URL"
        );
        assert_eq!(
            app_update_scrub_external_text(
                "ipv6=https://user:password@[2001:db8::1]/latest.json?ok=1,token=SECRET;next=HIDDEN#trace"
            ),
            "ipv6=https://[2001:db8::1]/latest.json"
        );

        let truncation_leak = format!(
            "{} https://user:SECRET_THAT_MUST_NOT_LEAK@updates.example/latest.json",
            "x".repeat(500)
        );
        let scrubbed = app_update_scrub_external_text(&truncation_leak);
        assert!(!scrubbed.contains("SECRET_THAT_MUST_NOT_LEAK"));
        assert!(!scrubbed.contains("user:"));

        assert_eq!(
            app_update_scrub_external_text(
                "https://safe.example/x;mirror=https://user:SECRET@host/y"
            ),
            "https://safe.example/x;mirror=https://host/y"
        );
    }

    #[test]
    fn check_error_classifies_network_failures_by_reqwest_text() {
        for error in [
            "Update check failed: error sending request for url (https://updates.example/latest.json)",
            "Update check failed: connection refused",
            "Update check failed: dns error",
            "Update check failed: operation timed out",
            "Update check failed: failed to lookup address information",
        ] {
            assert!(
                app_update_check_error_is_network_class(error),
                "expected network-class error: {error}"
            );
        }

        for error in [
            "Update check failed: signature verification failed",
            "Update check failed: could not parse manifest JSON",
            "Could not build updater: invalid endpoint",
            // URL text must not drive classification: a signature failure
            // quoting an endpoint whose path contains network-y words stays
            // non-network.
            "Update check failed: signature verification failed for https://cdn.example/connection-timeout/updater.json",
        ] {
            assert!(
                !app_update_check_error_is_network_class(error),
                "expected reportable error: {error}"
            );
        }
    }

    #[test]
    fn check_retry_ladder_progresses_then_returns_to_recheck_interval() {
        assert_eq!(app_update_check_retry_after_secs(1), 30);
        assert_eq!(app_update_check_retry_after_secs(2), 2 * 60);
        assert_eq!(app_update_check_retry_after_secs(3), 10 * 60);
        assert_eq!(
            app_update_check_retry_after_secs(4),
            APP_UPDATE_RECHECK_INTERVAL_SECS
        );
        assert_eq!(
            app_update_check_retry_after_secs(99),
            APP_UPDATE_RECHECK_INTERVAL_SECS
        );
    }

    #[test]
    fn check_failure_decision_keeps_first_network_failure_quiet() {
        let first = app_update_check_failure_decision(
            AppUpdateCheckRetryState::default(),
            "Update check failed: error sending request for url (https://updates.example/latest.json)",
        );
        assert!(!first.publish_failed_state);
        assert_eq!(first.retry_after_secs, 30);
        assert_eq!(first.next_state.consecutive_network_failures, 1);

        let second =
            app_update_check_failure_decision(first.next_state, "Update check failed: dns error");
        assert!(second.publish_failed_state);
        assert_eq!(second.retry_after_secs, 2 * 60);
        assert_eq!(second.next_state.consecutive_network_failures, 2);

        let reportable = app_update_check_failure_decision(
            second.next_state,
            "Update check failed: signature verification failed",
        );
        assert!(reportable.publish_failed_state);
        assert_eq!(
            reportable.retry_after_secs,
            APP_UPDATE_RECHECK_INTERVAL_SECS
        );
        assert_eq!(reportable.next_state, AppUpdateCheckRetryState::default());
    }

    fn test_remote_context(token: u64) -> AppUpdateRemoteCommandContext {
        AppUpdateRemoteCommandContext {
            token,
            state: CloudMcpState::new(),
            event: json!({ "command_id": format!("command-{token}") }),
            reply: AppUpdateRemoteReplyState::Pending,
        }
    }

    fn test_operation() -> AppUpdateRemoteOperation {
        AppUpdateRemoteOperation {
            generation: 1,
            phase: AppUpdateOperationPhase::Idle,
            attached: Vec::new(),
        }
    }

    #[test]
    fn operation_terminal_reaches_each_attached_command_once() {
        let mut operation = test_operation();
        let generation = operation.begin_download().expect("operation starts");
        operation.bind(test_remote_context(11));
        operation.bind(test_remote_context(12));

        let delivery = operation
            .commit_terminal(
                generation,
                AppUpdateRemoteTerminalStatus {
                    status: "failed".to_string(),
                    message: "download failed".to_string(),
                },
                true,
            )
            .expect("generation commits once");
        let delivered_tokens = delivery
            .contexts
            .iter()
            .map(|context| context.token)
            .collect::<Vec<_>>();
        assert_eq!(delivered_tokens, vec![11, 12]);
        assert!(operation
            .commit_terminal(
                generation,
                AppUpdateRemoteTerminalStatus {
                    status: "failed".to_string(),
                    message: "duplicate".to_string(),
                },
                true,
            )
            .is_none());
        assert!(operation.finish_terminal_reply(generation, 11));
        assert!(operation.finish_terminal_reply(generation, 12));
        assert!(!operation.finish_terminal_reply(generation, 12));
        assert_eq!(operation.phase, AppUpdateOperationPhase::Idle);
    }

    #[test]
    fn stale_finisher_cannot_clear_newer_operation_generation() {
        let mut operation = test_operation();
        let stale_generation = operation.begin_download().expect("first operation starts");
        operation.bind(test_remote_context(21));
        operation
            .commit_terminal(
                stale_generation,
                AppUpdateRemoteTerminalStatus {
                    status: "completed".to_string(),
                    message: "first complete".to_string(),
                },
                true,
            )
            .expect("first generation commits");
        assert!(operation.finish_terminal_reply(stale_generation, 21));

        let current_generation = operation.begin_download().expect("next operation starts");
        let current_binding = operation.bind(test_remote_context(22));
        assert_ne!(stale_generation, current_generation);
        assert!(operation
            .commit_terminal(
                stale_generation,
                AppUpdateRemoteTerminalStatus {
                    status: "failed".to_string(),
                    message: "late failure".to_string(),
                },
                true,
            )
            .is_none());
        assert_eq!(operation.generation, current_generation);
        assert_eq!(operation.phase, AppUpdateOperationPhase::Active);
        assert!(operation.contains(current_binding));
    }

    #[test]
    fn queued_reply_hands_off_to_terminal_before_generation_advances() {
        let mut operation = test_operation();
        let generation = operation.begin_download().expect("operation starts");
        let binding = operation.bind(test_remote_context(31));
        assert!(operation.begin_nonterminal_reply(binding).is_some());

        let owner_delivery = operation
            .commit_terminal(
                generation,
                AppUpdateRemoteTerminalStatus {
                    status: "failed".to_string(),
                    message: "download failed".to_string(),
                },
                true,
            )
            .expect("owner commits terminal");
        assert!(owner_delivery.contexts.is_empty());
        let ordered_terminal = operation
            .finish_nonterminal_reply(binding)
            .expect("queued sender inherits terminal delivery");
        assert_eq!(ordered_terminal.contexts[0].token, 31);
        assert_eq!(ordered_terminal.terminal.status, "failed");
        assert_eq!(operation.generation, generation);

        assert!(operation.finish_terminal_reply(generation, 31));
        assert_eq!(operation.phase, AppUpdateOperationPhase::Idle);
    }

    #[test]
    fn owner_restart_terminal_does_not_reopen_operation_slot() {
        let mut operation = test_operation();
        let generation = operation.begin_download().expect("operation starts");
        let first = operation.bind(test_remote_context(41));
        let first_delivery = operation
            .commit_terminal(
                generation,
                AppUpdateRemoteTerminalStatus {
                    status: "completed".to_string(),
                    message: "restarting".to_string(),
                },
                false,
            )
            .expect("owner commits restart terminal");
        assert_eq!(first_delivery.contexts[0].token, 41);

        let late = operation.bind(test_remote_context(42));
        assert!(!late.started_new);
        assert_eq!(late.phase, AppUpdateOperationPhaseKind::Terminal);
        assert!(operation.begin_download().is_none());
        assert!(operation.finish_terminal_reply(generation, first.token));
        let late_delivery = operation
            .claim_bound_terminal(late)
            .expect("late attachment receives owner terminal");
        assert_eq!(late_delivery.terminal.status, "completed");
        assert!(operation.finish_terminal_reply(generation, late.token));
        assert_eq!(operation.generation, generation);
        assert!(matches!(
            operation.phase,
            AppUpdateOperationPhase::Terminal {
                advance_when_drained: false,
                ..
            }
        ));
    }

    #[test]
    fn shutdown_drains_attached_commands_and_advances_generation() {
        let mut operation = test_operation();
        let generation = operation.begin_download().expect("operation starts");
        let queued = operation.bind(test_remote_context(51));
        operation.bind(test_remote_context(52));
        assert!(operation.begin_nonterminal_reply(queued).is_some());
        assert!(operation.mark_restart_pending(generation));

        let (shutdown_generation, delivery) = operation
            .commit_shutdown_terminal(AppUpdateRemoteTerminalStatus {
                status: "failed".to_string(),
                message: "Desktop app is shutting down before the update completed.".to_string(),
            })
            .expect("shutdown terminalizes the live generation");
        assert_eq!(shutdown_generation, generation);
        assert!(delivery.before_exit);
        assert_eq!(delivery.terminal.status, "failed");
        assert_eq!(
            delivery
                .contexts
                .iter()
                .map(|context| context.token)
                .collect::<Vec<_>>(),
            vec![52]
        );
        let ordered_terminal = operation
            .finish_nonterminal_reply(queued)
            .expect("queued reply hands off to the shutdown terminal");
        assert!(ordered_terminal.before_exit);
        assert_eq!(ordered_terminal.contexts[0].token, 51);
        assert!(operation.finish_terminal_reply(generation, 52));
        assert!(operation.finish_terminal_reply(generation, 51));
        assert_eq!(operation.phase, AppUpdateOperationPhase::Idle);
        assert_ne!(operation.generation, generation);
    }

    #[test]
    fn persistent_auth_rejection_terminalizes_once_and_preserves_staged_update() {
        let staged = AppUpdateStaged {
            version: "9.9.9".to_string(),
            installed: true,
            bytes: Some(vec![1, 2, 3]),
        };
        let mut operation = test_operation();
        let generation = operation.begin_download().expect("operation starts");
        operation.bind(test_remote_context(61));
        operation.bind(test_remote_context(62));
        assert!(operation.mark_restart_pending(generation));

        let delivery = operation
            .commit_restart_pending_terminal(
                generation,
                AppUpdateRemoteTerminalStatus {
                    status: "failed".to_string(),
                    message: app_update_persistent_auth_restart_message().to_string(),
                },
            )
            .expect("persistent rejection terminalizes the generation");
        assert_eq!(delivery.contexts.len(), 2);
        assert!(operation
            .commit_terminal(
                generation,
                AppUpdateRemoteTerminalStatus {
                    status: "failed".to_string(),
                    message: "duplicate rejection".to_string(),
                },
                true,
            )
            .is_none());
        assert!(operation.finish_terminal_reply(generation, 61));
        assert!(operation.finish_terminal_reply(generation, 62));
        assert!(!operation.finish_terminal_reply(generation, 61));
        assert!(!operation.finish_terminal_reply(generation, 62));
        assert_eq!(operation.phase, AppUpdateOperationPhase::Idle);
        assert_eq!(staged.version, "9.9.9");
        assert!(staged.installed);
        assert_eq!(staged.bytes.as_deref(), Some([1, 2, 3].as_slice()));
        assert!(operation.begin_download().is_some());
    }

    #[test]
    fn exit_delivery_gate_releases_after_bounded_failures() {
        assert!(!app_update_exit_terminal_delivery_can_release(1, false));
        assert!(!app_update_exit_terminal_delivery_can_release(2, false));
        assert!(app_update_exit_terminal_delivery_can_release(
            APP_UPDATE_EXIT_TERMINAL_DELIVERY_ATTEMPTS,
            false,
        ));
        assert!(app_update_exit_terminal_delivery_can_release(1, true));

        let mut operation = test_operation();
        let generation = operation.begin_download().expect("operation starts");
        operation.bind(test_remote_context(71));
        let delivery = operation
            .commit_terminal(
                generation,
                AppUpdateRemoteTerminalStatus {
                    status: "failed".to_string(),
                    message: "plain failure".to_string(),
                },
                true,
            )
            .expect("plain terminal starts delivery");
        assert!(!delivery.before_exit);
        let shutdown_claim = operation
            .claim_pending_terminal_delivery(generation, true)
            .expect("shutdown upgrades the terminal generation");
        assert!(shutdown_claim.contexts.is_empty());
        let first = operation.finish_terminal_delivery_attempt(generation, 71, 1, false, false);
        assert!(first.before_exit);
        assert!(first.retry);
        assert_eq!(operation.attached.len(), 1);
        let bounded = operation.finish_terminal_delivery_attempt(
            generation,
            71,
            APP_UPDATE_EXIT_TERMINAL_DELIVERY_ATTEMPTS,
            false,
            false,
        );
        assert!(bounded.before_exit);
        assert!(!bounded.retry);
        assert!(operation.attached.is_empty());
        assert_eq!(operation.phase, AppUpdateOperationPhase::Idle);
    }

    #[test]
    fn persisted_auto_restart_accepts_legacy_camel_case() {
        assert!(app_update_persisted_auto_restart_when_idle(&json!({
            "autoRestartWhenIdle": true
        })));
        assert!(!app_update_persisted_auto_restart_when_idle(&json!({
            "auto_restart_when_idle": false,
            "autoRestartWhenIdle": true
        })));
    }

    #[test]
    fn effective_auto_restart_uses_daemon_default() {
        assert!(app_update_effective_auto_restart_when_idle(
            false, true, None
        ));
        assert!(app_update_effective_auto_restart_when_idle(
            true, false, None
        ));
        assert!(!app_update_effective_auto_restart_when_idle(
            false, false, None
        ));
    }

    #[test]
    fn daemon_auto_update_env_zero_disables_daemon_default() {
        assert!(!app_update_effective_auto_restart_when_idle(
            false,
            true,
            Some("0")
        ));
        assert!(!app_update_effective_auto_restart_when_idle(
            true,
            true,
            Some("false")
        ));
        assert!(app_update_effective_auto_restart_when_idle(
            true,
            false,
            Some("0")
        ));
    }

    #[test]
    fn automatic_restart_auth_decision_blocks_auth_rejection() {
        assert_eq!(
            app_update_automatic_restart_auth_decision(
                DesktopAuthPreflightStatus::AuthOk,
                false,
                false,
            ),
            AppUpdateAutomaticRestartAuthDecision::Proceed
        );
        assert_eq!(
            app_update_automatic_restart_auth_decision(
                DesktopAuthPreflightStatus::NoSession,
                false,
                false,
            ),
            AppUpdateAutomaticRestartAuthDecision::Proceed
        );
        assert_eq!(
            app_update_automatic_restart_auth_decision(
                DesktopAuthPreflightStatus::AuthRejected,
                false,
                false,
            ),
            AppUpdateAutomaticRestartAuthDecision::Block
        );
    }

    #[test]
    fn automatic_restart_auth_decision_defers_one_transport_cycle() {
        assert_eq!(
            app_update_automatic_restart_auth_decision(
                DesktopAuthPreflightStatus::TransportError,
                false,
                false,
            ),
            AppUpdateAutomaticRestartAuthDecision::Defer
        );
        assert_eq!(
            app_update_automatic_restart_auth_decision(
                DesktopAuthPreflightStatus::TransportError,
                false,
                true,
            ),
            AppUpdateAutomaticRestartAuthDecision::Proceed
        );
    }

    #[test]
    fn automatic_restart_auth_decision_daemon_mode_always_proceeds() {
        // Headless BYOC daemons use device-token auth; a desktop-session
        // preflight rejection must never permanently block OTA updates.
        for status in [
            DesktopAuthPreflightStatus::AuthOk,
            DesktopAuthPreflightStatus::NoSession,
            DesktopAuthPreflightStatus::AuthRejected,
            DesktopAuthPreflightStatus::TransportError,
        ] {
            for transport_deferred_once in [false, true] {
                assert_eq!(
                    app_update_automatic_restart_auth_decision(
                        status,
                        true,
                        transport_deferred_once,
                    ),
                    AppUpdateAutomaticRestartAuthDecision::Proceed
                );
            }
        }
    }
}

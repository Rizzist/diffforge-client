const HAIDER_BRIDGE_COMMAND_TIMEOUT: Duration = Duration::from_secs(5);
const HAIDER_BRIDGE_INITIAL_SYNC_DELAY: Duration = Duration::from_secs(3);
const HAIDER_BRIDGE_FULL_RECONCILE_INTERVAL: Duration = Duration::from_secs(5 * 60);
const HAIDER_BRIDGE_WATCH_RECONCILE_INTERVAL: Duration = Duration::from_secs(30 * 60);
const HAIDER_BRIDGE_MAX_JSON_BYTES: u64 = 16 * 1024 * 1024;
const HAIDER_ROSTER_BOOTSTRAP_CHANGED_EVENT: &str = "haider-roster-bootstrap-changed";
const HAIDER_ROSTER_BOOTSTRAP_REQUEST_EVENT: &str = "haider-roster-bootstrap-request";
const HAIDER_ROSTER_BOOTSTRAP_PENDING_REASON: &str =
    "Awaiting a fresh complete daemon roster for the current connection.";
const HAIDER_ROSTER_BOOTSTRAP_UNREACHABLE_REASON: &str =
    "The Haider daemon is not reachable.";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
enum HaiderRosterBootstrapState {
    Reachable {
        profile_id: String,
        daemon_generation: u64,
        applied_at_ms: i64,
    },
    Pending {
        reason: String,
    },
    Unreachable {
        reason: String,
    },
}

impl Default for HaiderRosterBootstrapState {
    fn default() -> Self {
        Self::Pending {
            reason: HAIDER_ROSTER_BOOTSTRAP_PENDING_REASON.to_string(),
        }
    }
}

#[derive(Default)]
struct HaiderRosterBootstrapTracker {
    connection: Option<haider_rpc_ade::RosterConnectionIdentity>,
    state: HaiderRosterBootstrapState,
}

impl HaiderRosterBootstrapTracker {
    fn connection_pending(
        &mut self,
        connection: haider_rpc_ade::RosterConnectionIdentity,
    ) -> Option<HaiderRosterBootstrapState> {
        if self.connection.as_ref() == Some(&connection) {
            return None;
        }
        self.connection = Some(connection);
        let state = HaiderRosterBootstrapState::Pending {
            reason: HAIDER_ROSTER_BOOTSTRAP_PENDING_REASON.to_string(),
        };
        self.state = state.clone();
        Some(state)
    }

    fn connection_unreachable(&mut self) -> Option<HaiderRosterBootstrapState> {
        self.connection = None;
        self.replace(HaiderRosterBootstrapState::Unreachable {
            reason: HAIDER_ROSTER_BOOTSTRAP_UNREACHABLE_REASON.to_string(),
        })
    }

    fn complete_roster_applied(
        &mut self,
        connection: &haider_rpc_ade::RosterConnectionIdentity,
        applied_at_ms: i64,
    ) -> Option<HaiderRosterBootstrapState> {
        if self.connection.as_ref() != Some(connection)
            || matches!(&self.state, HaiderRosterBootstrapState::Reachable { .. })
        {
            return None;
        }
        self.replace(HaiderRosterBootstrapState::Reachable {
            profile_id: connection.profile_id.clone(),
            daemon_generation: connection.daemon_generation,
            applied_at_ms,
        })
    }

    fn replace(
        &mut self,
        state: HaiderRosterBootstrapState,
    ) -> Option<HaiderRosterBootstrapState> {
        if self.state == state {
            return None;
        }
        self.state = state.clone();
        Some(state)
    }
}

fn haider_roster_bootstrap_tracker() -> &'static StdMutex<HaiderRosterBootstrapTracker> {
    static TRACKER: OnceLock<StdMutex<HaiderRosterBootstrapTracker>> = OnceLock::new();
    TRACKER.get_or_init(|| StdMutex::new(HaiderRosterBootstrapTracker::default()))
}

// `app.emit` is synchronous. Callers hold the tracker mutex across mutation
// (or snapshot clone) and this non-locking helper so bootstrap events have the
// same total order as the states they publish.
fn haider_bridge_emit_roster_bootstrap(app: &AppHandle, state: HaiderRosterBootstrapState) {
    let _ = app.emit(HAIDER_ROSTER_BOOTSTRAP_CHANGED_EVENT, state);
}

fn haider_bridge_emit_current_roster_bootstrap(app: &AppHandle) {
    if let Ok(tracker) = haider_roster_bootstrap_tracker().lock() {
        haider_bridge_emit_roster_bootstrap(app, tracker.state.clone());
    }
}

pub(crate) fn haider_bridge_roster_connection_pending(
    app: &AppHandle,
    connection: haider_rpc_ade::RosterConnectionIdentity,
) -> bool {
    if let Ok(mut tracker) = haider_roster_bootstrap_tracker().lock() {
        if let Some(state) = tracker.connection_pending(connection) {
            haider_bridge_emit_roster_bootstrap(app, state);
            return true;
        }
    }
    false
}

pub(crate) fn haider_bridge_roster_connection_unreachable(app: &AppHandle) {
    if let Ok(mut tracker) = haider_roster_bootstrap_tracker().lock() {
        if let Some(state) = tracker.connection_unreachable() {
            haider_bridge_emit_roster_bootstrap(app, state);
        }
    }
}

fn haider_bridge_roster_complete_applied(
    app: &AppHandle,
    connection: &haider_rpc_ade::RosterConnectionIdentity,
) {
    if !haider_rpc_ade::roster_connection_is_current(connection) {
        return;
    }
    if let Ok(mut tracker) = haider_roster_bootstrap_tracker().lock() {
        if let Some(state) = tracker.complete_roster_applied(connection, sessions_now_ms()) {
            haider_bridge_emit_roster_bootstrap(app, state);
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct HaiderBridgeSession {
    id: String,
    harness: Value,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum HaiderBridgeSummarySource {
    Rpc,
    Cli,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct HaiderBridgeReconcilePolicy {
    source: HaiderBridgeSummarySource,
    rpc_live: bool,
}

impl HaiderBridgeReconcilePolicy {
    const fn rpc() -> Self {
        Self {
            source: HaiderBridgeSummarySource::Rpc,
            rpc_live: true,
        }
    }

    const fn cli(rpc_live: bool) -> Self {
        Self {
            source: HaiderBridgeSummarySource::Cli,
            rpc_live,
        }
    }

    fn preserves_stored_harness(self, harness: &Value) -> bool {
        // Source precedence is enforced at the transaction boundary. The
        // shape check keeps a rich row authoritative across disconnect and
        // across CLI work admitted before the roster watch became healthy.
        self.source == HaiderBridgeSummarySource::Cli
            && (self.rpc_live || haider_bridge_harness_is_rpc_shape(harness))
    }

    fn imports_payloads(self) -> bool {
        self.source == HaiderBridgeSummarySource::Rpc || !self.rpc_live
    }
}

fn haider_bridge_harness_is_rpc_shape(harness: &Value) -> bool {
    let Some(object) = harness.as_object() else {
        return false;
    };
    [
        "agent_metrics",
        "footprint_tokens",
        "footprint_truth",
        "last_model",
        "turn_count",
        "head_seq",
        "workspace_cwd",
    ]
    .iter()
    .any(|key| object.contains_key(*key))
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct HaiderBridgeReconcileStamp {
    head_seq: Option<i64>,
    harness: Value,
}

impl HaiderBridgeReconcileStamp {
    fn new(session: &HaiderBridgeSession, head_seq: Option<i64>) -> Self {
        Self {
            head_seq,
            harness: session.harness.clone(),
        }
    }
}

#[derive(Default)]
struct HaiderBridgeReconcileTracker {
    initialized: bool,
    sessions: HashMap<String, HaiderBridgeReconcileStamp>,
}

#[derive(Default)]
struct HaiderBridgeReconcileTrackers {
    rpc: HaiderBridgeReconcileTracker,
    cli: HaiderBridgeReconcileTracker,
}

impl HaiderBridgeReconcileTrackers {
    fn source_mut(
        &mut self,
        source: HaiderBridgeSummarySource,
    ) -> &mut HaiderBridgeReconcileTracker {
        match source {
            HaiderBridgeSummarySource::Rpc => &mut self.rpc,
            HaiderBridgeSummarySource::Cli => &mut self.cli,
        }
    }
}

static HAIDER_BRIDGE_STARTED: AtomicBool = AtomicBool::new(false);
static HAIDER_BRIDGE_STOPPING: AtomicBool = AtomicBool::new(false);

fn haider_bridge_head_sequences() -> &'static StdMutex<HashMap<String, i64>> {
    static HEADS: OnceLock<StdMutex<HashMap<String, i64>>> = OnceLock::new();
    HEADS.get_or_init(|| StdMutex::new(HashMap::new()))
}

fn haider_bridge_note_head_seq(session_id: &str, head_seq: i64) {
    if session_id.trim().is_empty() || head_seq < 0 {
        return;
    }
    if let Ok(mut heads) = haider_bridge_head_sequences().lock() {
        heads
            .entry(session_id.to_string())
            .and_modify(|head| *head = (*head).max(head_seq))
            .or_insert(head_seq);
    }
}

fn haider_bridge_head_seq(session_id: &str) -> Option<i64> {
    haider_bridge_head_sequences()
        .lock()
        .ok()
        .and_then(|heads| heads.get(session_id).copied())
}

fn haider_bridge_reconcile_trackers() -> &'static StdMutex<HaiderBridgeReconcileTrackers> {
    static TRACKERS: OnceLock<StdMutex<HaiderBridgeReconcileTrackers>> = OnceLock::new();
    TRACKERS.get_or_init(|| StdMutex::new(HaiderBridgeReconcileTrackers::default()))
}

fn haider_bridge_sync_lock() -> &'static StdMutex<()> {
    static LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| StdMutex::new(()))
}

enum HaiderBridgeRpcReconcileJob {
    Delta {
        app: AppHandle,
        summaries: Vec<Value>,
    },
    Snapshot {
        app: AppHandle,
        reply: Option<oneshot::Sender<bool>>,
    },
}

fn haider_bridge_rpc_reconcile_queue() -> &'static mpsc::UnboundedSender<HaiderBridgeRpcReconcileJob> {
    static QUEUE: OnceLock<mpsc::UnboundedSender<HaiderBridgeRpcReconcileJob>> = OnceLock::new();
    QUEUE.get_or_init(|| {
        let (sender, mut receiver) = mpsc::unbounded_channel();
        tauri::async_runtime::spawn(async move {
            while let Some(job) = receiver.recv().await {
                match job {
                    HaiderBridgeRpcReconcileJob::Delta { app, summaries } => {
                        haider_bridge_apply_summary_values(
                            &app,
                            summaries,
                            false,
                            HaiderBridgeReconcilePolicy::rpc(),
                        )
                        .await;
                    }
                    HaiderBridgeRpcReconcileJob::Snapshot { app, reply } => {
                        let live = haider_bridge_reconcile_rpc_snapshot_queued(&app).await;
                        if let Some(reply) = reply {
                            let _ = reply.send(live);
                        }
                    }
                }
            }
        });
        sender
    })
}

fn haider_bridge_json_args(args: &[&str]) -> Option<Value> {
    let mut child = Command::new("haider")
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let stdout = child.stdout.take()?;
    let reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout
            .take(HAIDER_BRIDGE_MAX_JSON_BYTES)
            .read_to_end(&mut bytes);
        bytes
    });
    let started_at = Instant::now();

    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if started_at.elapsed() < HAIDER_BRIDGE_COMMAND_TIMEOUT => {
                thread::sleep(Duration::from_millis(25));
            }
            Ok(None) | Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    };
    let bytes = reader.join().ok()?;
    if !status.is_some_and(|status| status.success()) {
        return None;
    }

    serde_json::from_slice(&bytes).ok().or_else(|| {
        bytes
            .split(|byte| *byte == b'\n')
            .rev()
            .find_map(|line| serde_json::from_slice(line).ok())
    })
}

fn haider_bridge_json_command(subcommand: &str) -> Option<Value> {
    haider_bridge_json_args(&[subcommand, "--json", "--no-spawn"])
}

fn haider_bridge_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => {
            let text = text.trim();
            (!text.is_empty()).then(|| text.to_string())
        }
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

fn haider_bridge_object_value<'a>(
    object: &'a serde_json::Map<String, Value>,
    keys: &[&str],
    wrappers: &[&str],
) -> Option<&'a Value> {
    keys.iter().find_map(|key| object.get(*key)).or_else(|| {
        wrappers.iter().find_map(|wrapper| {
            object
                .get(*wrapper)
                .and_then(Value::as_object)
                .and_then(|nested| keys.iter().find_map(|key| nested.get(*key)))
        })
    })
}

fn haider_bridge_sequence(value: &Value) -> Option<i64> {
    match value {
        Value::Number(number) => number.as_i64().or_else(|| {
            number
                .as_u64()
                .map(|value| value.min(i64::MAX as u64) as i64)
        }),
        Value::String(text) => text.trim().parse::<i64>().ok(),
        _ => None,
    }
    .map(|value| value.max(0))
}

fn haider_bridge_parse_session(
    value: &Value,
    inherited_id: Option<&str>,
) -> Option<HaiderBridgeSession> {
    let object = value.as_object()?;
    let id = haider_bridge_object_value(
        object,
        &["session_id", "sessionId", "id"],
        &["session", "summary"],
    )
    .and_then(haider_bridge_text)
    .or_else(|| inherited_id.map(str::to_string))?;
    if id.trim().is_empty() {
        return None;
    }
    Some(HaiderBridgeSession {
        id,
        harness: value.clone(),
    })
}

fn haider_bridge_collect_head_sequences(
    value: &Value,
    inherited_id: Option<&str>,
    observed: &mut HashMap<String, i64>,
) {
    match value {
        Value::Array(values) => {
            if let [Value::String(id), session] = values.as_slice() {
                haider_bridge_collect_head_sequences(session, Some(id), observed);
            } else {
                for value in values {
                    haider_bridge_collect_head_sequences(value, inherited_id, observed);
                }
            }
        }
        Value::Object(object) => {
            let session_id = haider_bridge_object_value(
                object,
                &["session_id", "sessionId", "id"],
                &["session", "summary"],
            )
            .and_then(haider_bridge_text)
            .or_else(|| inherited_id.map(str::to_string));
            let head_seq = haider_bridge_object_value(
                object,
                &["head_seq", "headSeq"],
                &["session", "summary"],
            )
            .and_then(haider_bridge_sequence);
            if let (Some(session_id), Some(head_seq)) = (session_id, head_seq) {
                haider_bridge_note_head_seq(&session_id, head_seq);
                observed
                    .entry(session_id)
                    .and_modify(|head| *head = (*head).max(head_seq))
                    .or_insert(head_seq);
            }
            for key in ["sessions", "items", "entries"] {
                let Some(container) = object.get(key) else {
                    continue;
                };
                if let Value::Object(keyed_sessions) = container {
                    for (id, value) in keyed_sessions {
                        haider_bridge_collect_head_sequences(value, Some(id), observed);
                    }
                } else {
                    haider_bridge_collect_head_sequences(container, None, observed);
                }
            }
            for key in ["data", "result", "response", "body"] {
                if let Some(container) = object.get(key) {
                    haider_bridge_collect_head_sequences(container, None, observed);
                }
            }
        }
        _ => {}
    }
}

fn haider_bridge_collect_sessions(
    value: &Value,
    inherited_id: Option<&str>,
    sessions: &mut Vec<HaiderBridgeSession>,
    lineage_available: bool,
) {
    if let Some(session) = haider_bridge_parse_session(value, inherited_id) {
        if !haider_bridge_is_subagent_session(value, lineage_available) {
            sessions.push(session);
        }
        return;
    }

    match value {
        Value::Array(values) => {
            if let [Value::String(id), session] = values.as_slice() {
                haider_bridge_collect_sessions(session, Some(id), sessions, lineage_available);
            } else {
                for value in values {
                    haider_bridge_collect_sessions(value, None, sessions, lineage_available);
                }
            }
        }
        Value::Object(object) => {
            for key in ["sessions", "items", "entries"] {
                let Some(container) = object.get(key) else {
                    continue;
                };
                if let Value::Object(keyed_sessions) = container {
                    for (id, value) in keyed_sessions {
                        haider_bridge_collect_sessions(value, Some(id), sessions, lineage_available);
                    }
                } else {
                    haider_bridge_collect_sessions(container, None, sessions, lineage_available);
                }
            }
            for key in ["data", "result", "response", "body"] {
                if let Some(container) = object.get(key) {
                    haider_bridge_collect_sessions(container, None, sessions, lineage_available);
                }
            }
        }
        _ => {}
    }
}

/// Lineage is meaningful only when its owning feature was negotiated. An id
/// prefix is never lineage evidence.
fn haider_bridge_is_subagent_session(value: &Value, lineage_available: bool) -> bool {
    if !lineage_available {
        return false;
    }
    let Some(object) = value.as_object() else {
        return false;
    };
    let kind = haider_bridge_object_value(object, &["kind"], &["summary", "metadata", "session"])
        .and_then(Value::as_str)
        .map(str::trim);
    let parent_session_id = haider_bridge_object_value(
        object,
        &["parent_session_id", "parentSessionId"],
        &["summary", "metadata", "session"],
    )
    .and_then(Value::as_str)
    .map(str::trim)
    .filter(|parent| !parent.is_empty());

    match kind {
        Some(kind) => kind == "subagent" || parent_session_id.is_some(),
        None if parent_session_id.is_some() => true,
        None => false,
    }
}

fn haider_bridge_parse_session_list(value: &Value) -> Vec<HaiderBridgeSession> {
    haider_bridge_parse_session_list_with_lineage(
        value,
        haider_rpc_ade::rpc_feature_advertised("session_lineage_v1"),
    )
}

fn haider_bridge_parse_session_list_with_lineage(
    value: &Value,
    lineage_available: bool,
) -> Vec<HaiderBridgeSession> {
    let mut sessions = Vec::new();
    haider_bridge_collect_sessions(value, None, &mut sessions, lineage_available);
    sessions.sort_by(|left, right| left.id.cmp(&right.id));
    sessions.dedup_by(|left, right| left.id == right.id);
    sessions
}

fn haider_bridge_canonical_path(path: &Path) -> Option<PathBuf> {
    path.canonicalize().ok()
}

fn haider_bridge_session_cwd(session: &HaiderBridgeSession) -> Option<PathBuf> {
    let object = session.harness.as_object()?;
    haider_bridge_object_value(
        object,
        &["workspace_cwd", "cwd"],
        &["summary", "workspace", "metadata", "session"],
    )
    .and_then(haider_bridge_text)
    .map(PathBuf::from)
}

fn haider_bridge_session_matches_dir(session: &HaiderBridgeSession, row: &SessionRow) -> bool {
    let Some(cwd) = haider_bridge_session_cwd(session)
        .as_deref()
        .and_then(haider_bridge_canonical_path)
    else {
        return false;
    };
    let directory = PathBuf::from(&row.dir);
    haider_bridge_canonical_path(&directory).is_some_and(|path| path == cwd)
        || haider_bridge_canonical_path(&directory.join("work")).is_some_and(|path| path == cwd)
}

fn haider_bridge_session_for_row<'a>(
    sessions: &'a [HaiderBridgeSession],
    row: &SessionRow,
) -> Option<&'a HaiderBridgeSession> {
    if row.provider_session_id.trim().is_empty() {
        sessions
            .iter()
            .find(|session| haider_bridge_session_matches_dir(session, row))
    } else {
        sessions
            .iter()
            .find(|session| session.id == row.provider_session_id)
    }
}

fn haider_bridge_reconcile_store_with_policy(
    policy: HaiderBridgeReconcilePolicy,
    roster: Option<&[HaiderBridgeSession]>,
    sessions: &[HaiderBridgeSession],
) -> Result<bool, String> {
    if roster.is_none() && sessions.is_empty() {
        return Ok(false);
    }
    let _write_guard = sessions_write_lock()
        .lock()
        .map_err(|_| "Sessions write lock is unavailable.".to_string())?;
    let mut connection = sessions_open_database()?;
    let query = format!("SELECT {SESSIONS_SELECT_COLUMNS} FROM sessions");
    let rows = {
        let mut statement = connection
            .prepare(&query)
            .map_err(|error| format!("Unable to prepare Haider reconciliation: {error}"))?;
        let decoded = statement
            .query_map([], sessions_sqlite_row)
            .map_err(|error| format!("Unable to query Haider sessions: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Unable to decode Haider session row: {error}"))?;
        decoded
    };
    let transaction = connection
        .transaction()
        .map_err(|error| format!("Unable to begin Haider reconciliation: {error}"))?;
    let mut changed = false;

    let mut rows = rows;

    for row in &mut rows {
        let roster_match = roster.and_then(|roster| haider_bridge_session_for_row(roster, row));
        let candidate_match = haider_bridge_session_for_row(sessions, row);
        if roster.is_some() && roster_match.is_none() {
            // A complete roster is the authority for surface membership,
            // including the empty roster. The historical row and its opaque
            // payload stay on disk; only its surface-membership bit changes.
            if row.provenance == SessionProvenance::Haider && row.roster_visible {
                transaction
                    .execute(
                        "UPDATE sessions SET roster_visible = 0 WHERE id = ?1",
                        [&row.id],
                    )
                    .map_err(|error| {
                        format!("Unable to hide absent Haider session: {error}")
                    })?;
                row.roster_visible = false;
                changed = true;
            }
            continue;
        }
        let Some(session) = candidate_match.or(roster_match) else {
            continue;
        };

        let replace_harness = candidate_match.is_some()
            && row.harness != session.harness
            && !policy.preserves_stored_harness(&row.harness);
        let mut row_changed = replace_harness;
        if row.provenance != SessionProvenance::Haider {
            row.provenance = SessionProvenance::Haider;
            row_changed = true;
        }
        if !row.roster_visible {
            row.roster_visible = true;
            row_changed = true;
        }
        if row.dir.trim().is_empty() {
            if let Some(cwd) = haider_bridge_session_cwd(session) {
                row.dir = cwd.to_string_lossy().into_owned();
                row_changed = true;
            }
        }
        if row.provider_session_id.trim().is_empty() {
            row.provider_session_id = session.id.clone();
            row_changed = true;
        }
        if !row_changed {
            continue;
        }
        if replace_harness {
            row.harness = session.harness.clone();
        }
        let harness_json = serde_json::to_string(&row.harness)
            .map_err(|error| format!("Unable to encode Haider session summary: {error}"))?;

        transaction
            .execute(
                "UPDATE sessions SET provider_session_id = ?2, harness_json = ?3, dir = ?4, \
                    provenance = ?5, roster_visible = ?6 WHERE id = ?1",
                rusqlite::params![
                    row.id,
                    row.provider_session_id,
                    harness_json,
                    row.dir,
                    row.provenance.stored_value(),
                    row.roster_visible,
                ],
            )
            .map_err(|error| format!("Unable to reconcile Haider session: {error}"))?;
        changed = true;
    }
    // Import daemon sessions the store doesn't know (created directly in the
    // haider CLI/TUI) so the home view can continue them. No directory is
    // imported summary's typed workspace is the only authoritative cwd.
    let bound: std::collections::HashSet<&str> = rows
        .iter()
        .filter(|row| !row.provider_session_id.trim().is_empty())
        .map(|row| row.provider_session_id.as_str())
        .collect();
    for session in roster.unwrap_or(sessions) {
        if !policy.imports_payloads() {
            continue;
        }
        if session.id.trim().is_empty() || bound.contains(session.id.as_str()) {
            continue;
        }
        let now_ms = sessions_now_ms();
        let dir = haider_bridge_session_cwd(session)
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default();
        let harness_json = serde_json::to_string(&session.harness)
            .map_err(|error| format!("Unable to encode imported Haider summary: {error}"))?;
        transaction
            .execute(
                "INSERT INTO sessions (
                    id, slug, dir, kind, provider_session_id, created_at_ms,
                    pinned, title_locked, harness_json, first_user_message,
                    provenance, roster_visible
                 ) VALUES (?1, '', ?3, 'pinned', ?2, ?4, 0, NULL, ?5, '', 'haider', 1)",
                rusqlite::params![sessions_new_id(now_ms), session.id, dir, now_ms, harness_json],
            )
            .map_err(|error| format!("Unable to import Haider session: {error}"))?;
        changed = true;
    }
    transaction
        .commit()
        .map_err(|error| format!("Unable to commit Haider reconciliation: {error}"))?;
    Ok(changed)
}

#[cfg(test)]
fn haider_bridge_reconcile_store(
    roster: Option<&[HaiderBridgeSession]>,
    sessions: &[HaiderBridgeSession],
) -> Result<bool, String> {
    haider_bridge_reconcile_store_with_policy(HaiderBridgeReconcilePolicy::rpc(), roster, sessions)
}

fn haider_bridge_reconcile_tracked(
    tracker: &mut HaiderBridgeReconcileTracker,
    sessions: &[HaiderBridgeSession],
    head_sequences: &HashMap<String, i64>,
    complete: bool,
    reconcile: impl FnOnce(
        Option<&[HaiderBridgeSession]>,
        &[HaiderBridgeSession],
    ) -> Result<bool, String>,
) -> Result<bool, String> {
    let mut snapshot = sessions
        .iter()
        .map(|session| {
            (
                session.id.clone(),
                HaiderBridgeReconcileStamp::new(session, head_sequences.get(&session.id).copied()),
            )
        })
        .collect::<HashMap<_, _>>();
    if tracker.initialized {
        for (session_id, incoming) in &mut snapshot {
            let Some(previous) = tracker.sessions.get(session_id) else {
                continue;
            };
            if incoming
                .head_seq
                .zip(previous.head_seq)
                .is_some_and(|(incoming, previous)| incoming < previous)
            {
                // A paginated complete seed can overlap a newer pushed delta.
                // Preserve the newer stamp so the stale page is neither a
                // store candidate nor a regression in the source tracker.
                *incoming = previous.clone();
            }
        }
    }
    let roster_changed = complete
        && tracker.initialized
        && (snapshot.len() != tracker.sessions.len()
            || snapshot
                .keys()
                .any(|session_id| !tracker.sessions.contains_key(session_id)));
    let candidates = if tracker.initialized {
        sessions
            .iter()
            .filter_map(|session| {
                (snapshot.contains_key(&session.id)
                    && (!head_sequences.contains_key(&session.id)
                        || snapshot.get(&session.id) != tracker.sessions.get(&session.id)))
                .then(|| session.clone())
            })
            .collect::<Vec<_>>()
    } else {
        sessions.to_vec()
    };
    if candidates.is_empty() && !roster_changed && !complete {
        tracker.initialized = true;
        if complete {
            tracker.sessions = snapshot;
        } else {
            tracker.sessions.extend(snapshot);
        }
        return Ok(false);
    }
    let changed = reconcile(complete.then_some(sessions), &candidates)?;
    tracker.initialized = true;
    if complete {
        tracker.sessions = snapshot;
    } else {
        tracker.sessions.extend(snapshot);
    }
    Ok(changed)
}

#[cfg(test)]
fn haider_bridge_reconcile(sessions: &[HaiderBridgeSession]) -> Result<bool, String> {
    haider_bridge_reconcile_store(Some(sessions), sessions)
}

fn haider_bridge_reconcile_summary_values_tracked(
    tracker: &mut HaiderBridgeReconcileTracker,
    summaries: Vec<Value>,
    complete: bool,
    reconcile: impl FnOnce(
        Option<&[HaiderBridgeSession]>,
        &[HaiderBridgeSession],
    ) -> Result<bool, String>,
) -> Result<bool, String> {
    let value = Value::Array(summaries);
    let mut head_sequences = HashMap::new();
    haider_bridge_collect_head_sequences(&value, None, &mut head_sequences);
    let sessions = haider_bridge_parse_session_list(&value);
    haider_bridge_reconcile_tracked(tracker, &sessions, &head_sequences, complete, reconcile)
}

fn haider_bridge_reconcile_summary_values_prefold(
    tracker: &mut HaiderBridgeReconcileTracker,
    summaries: Vec<Value>,
    complete: bool,
    reconcile: impl FnOnce(
        Option<&[HaiderBridgeSession]>,
        &[HaiderBridgeSession],
    ) -> Result<bool, String>,
    mut enqueue: impl FnMut(Vec<String>),
) -> Result<bool, String> {
    let mut prefold = Vec::new();
    let changed = haider_bridge_reconcile_summary_values_tracked(
        tracker,
        summaries,
        complete,
        |roster, candidates| {
            let changed = reconcile(roster, candidates)?;
            prefold.extend(candidates.iter().map(|session| session.id.clone()));
            Ok(changed)
        },
    )?;
    if !prefold.is_empty() {
        enqueue(prefold);
    }
    Ok(changed)
}

fn haider_bridge_reconcile_summary_values(
    summaries: Vec<Value>,
    complete: bool,
    policy: HaiderBridgeReconcilePolicy,
) -> Result<bool, String> {
    if policy == HaiderBridgeReconcilePolicy::cli(true) && complete {
        // A live CLI roster is absence evidence only. Do not feed its poor
        // stamps into either source tracker or enqueue projection work from
        // payloads that are forbidden to reach harness_json.
        let sessions = haider_bridge_parse_session_list(&Value::Array(summaries));
        return haider_bridge_reconcile_store_with_policy(policy, Some(&sessions), &[]);
    }
    let mut trackers = haider_bridge_reconcile_trackers()
        .lock()
        .map_err(|_| "Haider reconciliation tracker is unavailable.".to_string())?;
    let tracker = trackers.source_mut(policy.source);
    haider_bridge_reconcile_summary_values_prefold(
        tracker,
        summaries,
        complete,
        |roster, sessions| haider_bridge_reconcile_store_with_policy(policy, roster, sessions),
        haider_projection_prefold_enqueue_provider_sessions,
    )
}

async fn haider_bridge_apply_summary_values(
    app: &AppHandle,
    summaries: Vec<Value>,
    complete: bool,
    policy: HaiderBridgeReconcilePolicy,
) -> bool {
    let changed = tauri::async_runtime::spawn_blocking(move || {
        let _sync_guard = haider_bridge_sync_lock()
            .lock()
            .map_err(|_| "Haider bridge sync lock is unavailable.".to_string())?;
        haider_bridge_reconcile_summary_values(summaries, complete, policy)
    })
    .await;
    match changed {
        Ok(Ok(true)) => {
            sessions_emit_changed(app);
            true
        }
        Ok(Ok(false)) => true,
        Ok(Err(error)) => {
            eprintln!("Haider session reconciliation failed: {error}");
            false
        }
        Err(error) => {
            eprintln!("Haider session reconciliation worker failed: {error}");
            false
        }
    }
}

fn haider_bridge_reconcile_from_summaries(app: AppHandle, summaries: Vec<Value>) {
    let _ = haider_bridge_rpc_reconcile_queue()
        .send(HaiderBridgeRpcReconcileJob::Delta { app, summaries });
}

fn haider_bridge_seed_from_rpc(app: AppHandle) {
    // All RPC persistence uses this FIFO. A new connection enqueues its seed
    // after publishing the actor identity and before run_connected can enqueue
    // later wire deltas, so the snapshot cannot commit after a newer delta.
    let _ = haider_bridge_rpc_reconcile_queue().send(HaiderBridgeRpcReconcileJob::Snapshot {
        app,
        reply: None,
    });
}

fn haider_bridge_rpc_snapshot_permits_cli_fallback<T>(snapshot: &Option<Result<T, String>>) -> bool {
    snapshot.is_none()
}

async fn haider_bridge_reconcile_rpc_snapshot_queued(app: &AppHandle) -> bool {
    let snapshot = haider_rpc_ade::session_roster_snapshot_for_bootstrap_rpc().await;
    if haider_bridge_rpc_snapshot_permits_cli_fallback(&snapshot) {
        return false;
    }
    let Some(result) = snapshot else {
        unreachable!("offline RPC snapshots return before result decoding");
    };
    let snapshot = match result {
        Ok(snapshot) => snapshot,
        Err(error) => {
            eprintln!("Haider RPC roster seed failed: {error}");
            // A connected RPC route remains authoritative even when this
            // snapshot failed. Do not reinterpret a live protocol error as
            // permission for the poor CLI source to overwrite the store.
            return true;
        }
    };
    let applied = haider_bridge_apply_summary_values(
        app,
        snapshot.summaries,
        true,
        HaiderBridgeReconcilePolicy::rpc(),
    )
    .await;
    if applied {
        haider_bridge_roster_complete_applied(app, &snapshot.connection);
    }
    true
}

async fn haider_bridge_reconcile_rpc_snapshot(app: &AppHandle) -> bool {
    let (reply, answer) = oneshot::channel();
    if haider_bridge_rpc_reconcile_queue()
        .send(HaiderBridgeRpcReconcileJob::Snapshot {
            app: app.clone(),
            reply: Some(reply),
        })
        .is_err()
    {
        return true;
    }
    // A dead reconcile worker must fail closed: it is not evidence that RPC
    // is offline, so it cannot authorize the poor CLI payload source.
    answer.await.unwrap_or(true)
}

async fn haider_bridge_sync_once(app: &AppHandle) {
    if haider_bridge_reconcile_rpc_snapshot(app).await {
        return;
    }
    let changed = tauri::async_runtime::spawn_blocking(|| {
        let _sync_guard = haider_bridge_sync_lock()
            .lock()
            .map_err(|_| "Haider bridge sync lock is unavailable.".to_string())?;
        let Some(value) = haider_bridge_json_command("sessions") else {
            return Ok(false);
        };
        haider_bridge_reconcile_summary_values(
            vec![value],
            true,
            HaiderBridgeReconcilePolicy::cli(haider_rpc_ade::roster_watch_healthy()),
        )
    })
    .await;
    match changed {
        Ok(Ok(true)) => sessions_emit_changed(app),
        Ok(Ok(false)) => {}
        Ok(Err(error)) => eprintln!("Haider session reconciliation failed: {error}"),
        Err(error) => eprintln!("Haider session reconciliation worker failed: {error}"),
    }
}

fn haider_bridge_stop() {
    HAIDER_BRIDGE_STOPPING.store(true, Ordering::Release);
}

fn haider_bridge_full_reconcile_interval(roster_watch_healthy: bool) -> Duration {
    if roster_watch_healthy {
        HAIDER_BRIDGE_WATCH_RECONCILE_INTERVAL
    } else {
        HAIDER_BRIDGE_FULL_RECONCILE_INTERVAL
    }
}

fn haider_bridge_start(app: AppHandle) {
    if HAIDER_BRIDGE_STARTED.swap(true, Ordering::AcqRel) {
        return;
    }
    HAIDER_BRIDGE_STOPPING.store(false, Ordering::Release);
    if let Ok(mut trackers) = haider_bridge_reconcile_trackers().lock() {
        *trackers = HaiderBridgeReconcileTrackers::default();
    }
    if let Ok(mut tracker) = haider_roster_bootstrap_tracker().lock() {
        *tracker = HaiderRosterBootstrapTracker::default();
    }
    let request_app = app.clone();
    app.listen(HAIDER_ROSTER_BOOTSTRAP_REQUEST_EVENT, move |_| {
        haider_bridge_emit_current_roster_bootstrap(&request_app);
    });
    haider_rpc_ade::roster_watch_start(app.clone());

    let sync_app = app.clone();
    tauri::async_runtime::spawn(async move {
        sleep(HAIDER_BRIDGE_INITIAL_SYNC_DELAY).await;
        while !HAIDER_BRIDGE_STOPPING.load(Ordering::Acquire) {
            haider_bridge_sync_once(&sync_app).await;
            sleep(haider_bridge_full_reconcile_interval(
                haider_rpc_ade::roster_watch_healthy(),
            ))
            .await;
        }
    });
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
struct HaiderLibraryModel {
    model: String,
    provider: String,
    available: bool,
    legacy_availability: bool,
    supported_efforts: Vec<String>,
    supported_speeds: Vec<String>,
}

fn haider_library_catalog_models(
    providers: &[Value],
    availability: Option<&haider_rpc_ade::SnapshotAvailabilityWire>,
) -> Vec<HaiderLibraryModel> {
    if matches!(
        availability,
        Some(
            haider_rpc_ade::SnapshotAvailabilityWire::Unavailable { .. }
                | haider_rpc_ade::SnapshotAvailabilityWire::Unknown
        )
    ) {
        return Vec::new();
    }
    let legacy_availability = availability.is_none();
    let mut flattened = Vec::new();
    for provider in providers {
        let Some(provider) = provider.as_object() else {
            continue;
        };
        let provider_id = provider
            .get("provider")
            .and_then(haider_bridge_text)
            .unwrap_or_default();
        let available = provider
            .get("availability")
            .and_then(Value::as_str)
            .is_some_and(|availability| availability == "available")
            && provider.get("enabled").and_then(Value::as_bool) == Some(true);
        let model_details = provider
            .get("model_details")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let Some(models) = provider.get("models").and_then(Value::as_array) else {
            continue;
        };
        for model in models {
            let model = haider_bridge_text(model);
            let Some(model) = model else {
                continue;
            };
            let detail = model_details.iter().find(|detail| {
                detail.get("name").and_then(Value::as_str) == Some(model.as_str())
            });
            let string_list = |key: &str| {
                detail
                    .and_then(|detail| detail.get(key))
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(haider_bridge_text)
                    .collect::<Vec<_>>()
            };
            flattened.push(HaiderLibraryModel {
                model,
                provider: provider_id.clone(),
                available,
                legacy_availability,
                supported_efforts: string_list("supported_efforts"),
                supported_speeds: string_list("supported_speeds"),
            });
        }
    }
    flattened
}

fn haider_library_model_features_present(features: &[String]) -> bool {
    [
        "provider_management_v1",
        "provider_models_v1",
        "models_list_v1",
    ]
    .iter()
    .all(|required| features.iter().any(|feature| feature == required))
}

#[tauri::command(rename_all = "snake_case")]
async fn haider_library_snapshot() -> Value {
    let features = haider_rpc_ade::rpc_features().await;
    let model_features_present = haider_library_model_features_present(&features);
    let provider_snapshot = if features
        .iter()
        .any(|feature| feature == "provider_management_v1")
    {
        match haider_rpc_ade::provider_list_rpc(None).await {
            Ok(snapshot) => Some(snapshot),
            Err(_) => None,
        }
    } else {
        None
    };
    let account_snapshot = if features.iter().any(|feature| feature == "account_management_v1") {
        haider_rpc_ade::account_list(None).await.ok()
    } else {
        None
    };
    let models = if model_features_present {
        provider_snapshot.as_ref().map(|snapshot| {
            haider_library_catalog_models(&snapshot.providers, snapshot.availability.as_ref())
        })
        .unwrap_or_default()
    } else {
        Vec::new()
    };
    let providers = provider_snapshot.as_ref().map(|snapshot| {
        snapshot
            .providers
            .iter()
            .cloned()
            .map(|mut provider| {
                if !model_features_present {
                    if let Some(object) = provider.as_object_mut() {
                        object.remove("models");
                        object.remove("model_details");
                    }
                }
                provider
            })
            .collect::<Vec<_>>()
    });
    let mut efforts = models
        .iter()
        .flat_map(|model| model.supported_efforts.iter().cloned())
        .collect::<Vec<_>>();
    efforts.sort();
    efforts.dedup();
    let mut speeds = models
        .iter()
        .flat_map(|model| model.supported_speeds.iter().cloned())
        .collect::<Vec<_>>();
    speeds.sort();
    speeds.dedup();
    json!({
        "version": 3,
        "models": models,
        "providers": providers,
        "provider_revision": provider_snapshot.as_ref().map(|snapshot| snapshot.revision),
        "provider_availability": provider_snapshot.as_ref().and_then(|snapshot| snapshot.availability.as_ref()),
        "accounts": account_snapshot.as_ref().map(|snapshot| &snapshot.descriptors),
        "account_revision": account_snapshot.as_ref().and_then(|snapshot| snapshot.revision),
        "account_availability": account_snapshot.as_ref().and_then(|snapshot| snapshot.availability.as_ref()),
        "efforts": efforts,
        "speeds": speeds,
        "custom_commands": [],
        "capabilities": {
            "model_switch": features.iter().any(|feature| feature == "session_model_select_v1"),
            "effort_switch": features.iter().any(|feature| feature == "session_effort_select_v1"),
            "speed_switch": features.iter().any(|feature| feature == "session_fast_select_v1"),
            "account_switch": features.iter().any(|feature| feature == "session_account_select_v1"),
        },
    })
}

#[tauri::command]
async fn haider_usage_snapshot() -> Result<Value, String> {
    haider_usage_snapshot_value(haider_rpc_ade::usage_report_rpc().await)
}

fn haider_usage_snapshot_value(
    result: Result<haider_rpc_ade::UsageReportResult, String>,
) -> Result<Value, String> {
    let snapshot = result?;
    serde_json::to_value(snapshot)
        .map_err(|error| format!("Unable to serialize Haider usage snapshot: {error}"))
}

#[cfg(test)]
mod haider_bridge_tests {
    use super::*;

    fn roster_connection(
        profile_id: &str,
        daemon_generation: u64,
        connection_serial: u64,
    ) -> haider_rpc_ade::RosterConnectionIdentity {
        haider_rpc_ade::RosterConnectionIdentity {
            profile_id: profile_id.to_string(),
            daemon_generation,
            connection_serial,
        }
    }

    #[test]
    fn roster_bootstrap_requires_complete_apply_on_current_connection() {
        let connection = roster_connection("profile-fresh", 41, 1);
        let mut tracker = HaiderRosterBootstrapTracker::default();

        assert_eq!(tracker.complete_roster_applied(&connection, 90), None);
        assert!(matches!(
            &tracker.state,
            HaiderRosterBootstrapState::Pending { .. }
        ));

        tracker
            .connection_pending(connection.clone())
            .expect("a Welcome starts a pending connection");
        assert!(matches!(
            &tracker.state,
            HaiderRosterBootstrapState::Pending { .. }
        ));

        let reachable = tracker
            .complete_roster_applied(&connection, 123_456)
            .expect("the current connection's complete apply lifts the barrier");
        assert_eq!(
            serde_json::to_value(&reachable).expect("serialize bootstrap state"),
            json!({
                "state": "reachable",
                "profile_id": "profile-fresh",
                "daemon_generation": 41,
                "applied_at_ms": 123_456,
            })
        );
        assert_eq!(
            tracker.complete_roster_applied(&connection, 999_999),
            None,
            "only the first complete apply publishes reachability"
        );
    }

    #[test]
    fn roster_bootstrap_reconnect_and_generation_change_reset_pending() {
        let first = roster_connection("profile-stable", 7, 1);
        let reconnect = roster_connection("profile-stable", 7, 2);
        let next_generation = roster_connection("profile-stable", 8, 3);
        let mut tracker = HaiderRosterBootstrapTracker::default();

        tracker.connection_pending(first.clone());
        tracker.complete_roster_applied(&first, 100);
        assert!(matches!(
            &tracker.state,
            HaiderRosterBootstrapState::Reachable {
                daemon_generation: 7,
                ..
            }
        ));

        tracker
            .connection_pending(reconnect.clone())
            .expect("a reconnect resets a reachable generation to pending");
        assert!(matches!(
            &tracker.state,
            HaiderRosterBootstrapState::Pending { .. }
        ));
        assert_eq!(
            tracker.complete_roster_applied(&first, 101),
            None,
            "an old connection's late apply cannot lift the new barrier"
        );
        tracker.complete_roster_applied(&reconnect, 102);

        tracker
            .connection_pending(next_generation.clone())
            .expect("a new daemon generation resets reachability to pending");
        assert!(matches!(
            &tracker.state,
            HaiderRosterBootstrapState::Pending { .. }
        ));
        let reachable = tracker
            .complete_roster_applied(&next_generation, 103)
            .expect("the new generation's complete apply lifts its barrier");
        assert!(matches!(
            reachable,
            HaiderRosterBootstrapState::Reachable {
                profile_id,
                daemon_generation: 8,
                applied_at_ms: 103,
            } if profile_id == "profile-stable"
        ));

        tracker
            .connection_unreachable()
            .expect("disconnecting a reachable daemon publishes unreachable");
        assert!(matches!(
            &tracker.state,
            HaiderRosterBootstrapState::Unreachable { .. }
        ));
    }

    #[test]
    fn haider_usage_snapshot_preserves_rpc_failure_reason() {
        assert_eq!(
            haider_usage_snapshot_value(Err("daemon could not read usage".to_string())),
            Err("daemon could not read usage".to_string())
        );
    }

    #[test]
    fn haider_bridge_maps_run_states_defensively() {
        assert_eq!(
            sessions_run_state_text(Some(&json!({
                "status": "running_tool",
                "tool": "cargo"
            }))),
            "running_tool: cargo"
        );
        for state in [
            "active_run",
            "running",
            "streaming",
            "running_tool",
            "tool-call",
        ] {
            assert_eq!(
                sessions_status_from_run_state(Some(&json!(state))),
                "running"
            );
        }
        for state in ["waiting", "input_required", "permission-required"] {
            assert_eq!(
                sessions_status_from_run_state(Some(&json!(state))),
                "waiting"
            );
        }
        for state in ["errored", "run_failed", "fatal"] {
            assert_eq!(sessions_status_from_run_state(Some(&json!(state))), "error");
        }
        for state in ["idle", "paused", "closed"] {
            assert_eq!(sessions_status_from_run_state(Some(&json!(state))), "idle");
        }
        assert_eq!(sessions_status_from_run_state(None), "unknown");

        // This expectation was REVERSED deliberately. It used to assert that an
        // unrecognised state buckets as idle, which reads as defensive and is
        // the opposite: the daemon does not invent vocabulary for sitting still,
        // so a name we have never seen almost certainly describes work in
        // progress. Calling it idle tells the person watching that a busy
        // session is quiet — the one direction they cannot recover from, since
        // there is nothing on screen to prompt a second look. Over-reporting
        // activity is visible and self-correcting.
        assert_eq!(
            sessions_status_from_run_state(Some(&json!("future_unknown_state"))),
            "unknown"
        );
    }

    #[test]
    fn haider_bridge_parses_observed_session_summary_shape() {
        // The live daemon was unavailable during capture. These keys come from
        // v0.0.925's SessionSummary/SessionFleetSnapshot wire metadata.
        let sample = json!({
            "sessions": [{
                "session_id": "sess_01JTEST",
                "title": "Review the parser",
                "workspace_cwd": "/tmp/diffforge-project/work",
                "run_state": { "status": "running_tool", "tool": "cargo" },
                "updated_at_ms": 1_777_777_777_123_i64,
                "head_seq": 42,
                "last_model": "test-model",
                "turn_count": 3,
                "footprint_tokens": 12_345,
                "footprint_truth": "metered",
                "agent_metrics": null,
                "unknown_future_field": { "safe": true }
            }]
        });
        let parsed = haider_bridge_parse_session_list(&sample);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].id, "sess_01JTEST");
        assert_eq!(parsed[0].harness, sample["sessions"][0]);
        assert_eq!(parsed[0].harness["unknown_future_field"]["safe"], true);
    }

    #[test]
    fn haider_bridge_does_not_extract_roster_scalars() {
        let with_scalars = json!({
            "session_id": "session-935",
            "run_state": "running",
            "state_raw": "idle",
            "effort": "xhigh",
            "fast": true,
            "seen_at_ms": 1_234_i64,
            "last_activity_ms": "2345",
            "waiting_why": {
                "kind": "permission",
                "pending_menu_id": "menu-935"
            },
            "account_alias": null
        });
        let parsed = haider_bridge_parse_session(&with_scalars, None).unwrap();
        assert_eq!(parsed.harness, with_scalars);
    }

    #[test]
    fn haider_bridge_preserves_unknown_needs_input_kind_verbatim() {
        let needs_input = json!({
            "kind": "future_daemon_prompt",
            "title": "A future prompt",
            "safe_body": ["Only daemon-redacted text is present."],
            "menu_id": "menu-future",
            "request_seq": 1843_u64,
            "worker_generation": 122_u64,
            "since_ms": 1_777_777_777_123_i64,
            "options": [{
                "key": "continue",
                "label": "Continue",
                "detail": "Use the generic frontend arm."
            }],
            "future_additive_field": {"preserved": true}
        });
        let parsed = haider_bridge_parse_session(
            &json!({
                "session_id": "session-future-needs-input",
                "head_seq": 9,
                "needs_input": needs_input
            }),
            None,
        )
        .unwrap();

        assert_eq!(parsed.harness["needs_input"], needs_input);
        assert_eq!(
            parsed.harness["needs_input"]["kind"],
            "future_daemon_prompt"
        );
    }

    #[test]
    fn haider_bridge_reconcile_stamp_tracks_the_entire_payload() {
        let session = HaiderBridgeSession {
            id: "session-stamp".to_string(),
            harness: json!({"session_id": "session-stamp", "effort": "medium"}),
        };
        let baseline = HaiderBridgeReconcileStamp::new(&session, Some(4));
        let mut unknown_changed = session;
        unknown_changed.harness["field_the_bridge_does_not_know"] = json!({"value": 50});
        assert_ne!(
            baseline,
            HaiderBridgeReconcileStamp::new(&unknown_changed, Some(4))
        );
    }

    #[test]
    fn haider_bridge_reconcile_interval_follows_roster_watch_health() {
        assert_eq!(
            haider_bridge_full_reconcile_interval(false),
            HAIDER_BRIDGE_FULL_RECONCILE_INTERVAL
        );
        assert_eq!(
            haider_bridge_full_reconcile_interval(true),
            HAIDER_BRIDGE_WATCH_RECONCILE_INTERVAL
        );
    }

    #[test]
    fn haider_bridge_cli_fallback_requires_an_offline_rpc_route() {
        let unavailable: Option<Result<Vec<Value>, String>> = None;
        let live_error: Option<Result<Vec<Value>, String>> =
            Some(Err("protocol rejected the snapshot".to_string()));
        let live_success: Option<Result<Vec<Value>, String>> = Some(Ok(Vec::new()));

        assert!(haider_bridge_rpc_snapshot_permits_cli_fallback(&unavailable));
        assert!(!haider_bridge_rpc_snapshot_permits_cli_fallback(&live_error));
        assert!(!haider_bridge_rpc_snapshot_permits_cli_fallback(&live_success));
    }

    #[test]
    fn absent_lineage_does_not_infer_from_session_id_prefix() {
        let sample = json!({
            "sessions": [
                {"id": "session-abc123", "title": "Real work", "updated_at": 5_i64},
                {"id": "session-child-deadbeef", "title": "Delegated task: pick", "updated_at": 6_i64},
            ]
        });
        let parsed = haider_bridge_parse_session_list_with_lineage(&sample, true);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].id, "session-abc123");
        assert_eq!(parsed[1].id, "session-child-deadbeef");
        assert!(!haider_bridge_is_subagent_session(&json!({}), true));
    }

    #[test]
    fn haider_bridge_typed_lineage_wins_over_prefix_fallback() {
        let sample = json!({
            "sessions": [
                {
                    "id": "session-child-direct",
                    "kind": "direct",
                    "title": "Typed direct session"
                },
                {
                    "id": "session-ordinary-subagent",
                    "kind": "subagent",
                    "title": "Typed child session"
                }
            ]
        });
        let parsed = haider_bridge_parse_session_list_with_lineage(&sample, true);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].id, "session-child-direct");
    }

    #[test]
    fn haider_bridge_parent_only_lineage_marks_subagent() {
        let sample = json!({
            "sessions": [{
                "id": "session-no-child-prefix",
                "parent_session_id": "session-parent",
                "title": "Child by parent"
            }]
        });
        assert!(haider_bridge_parse_session_list_with_lineage(&sample, true).is_empty());
    }

    #[test]
    fn model_inventory_requires_both_owner_bits_and_composed_list_bit() {
        let strings = |values: &[&str]| values.iter().map(|value| value.to_string()).collect::<Vec<_>>();
        assert!(!haider_library_model_features_present(&strings(&[
            "provider_management_v1",
            "provider_models_v1",
        ])));
        assert!(haider_library_model_features_present(&strings(&[
            "provider_management_v1",
            "provider_models_v1",
            "models_list_v1",
        ])));
    }

    #[test]
    fn haider_bridge_parses_keyed_sessions_and_numeric_activity() {
        let sample = json!({
            "result": {
                "sessions": {
                    "session-from-map-key": {
                        "metadata": { "name": "Nested session" },
                        "summary": {
                            "workspace_cwd": "/tmp/nested",
                            "updated_at": 1_776_582_489,
                            "model": "current-model",
                            "head_seq": 12
                        },
                        "runtime": { "state": "input-required" }
                    }
                }
            }
        });
        let parsed = haider_bridge_parse_session_list(&sample);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].id, "session-from-map-key");
        assert_eq!(
            parsed[0].harness,
            sample["result"]["sessions"]["session-from-map-key"]
        );
        let mut heads = HashMap::new();
        haider_bridge_collect_head_sequences(&sample, None, &mut heads);
        assert_eq!(heads.get("session-from-map-key"), Some(&12));
    }

    #[test]
    fn haider_bridge_unchanged_delta_head_skips_store_reconcile() {
        let session = HaiderBridgeSession {
            id: "session-test".to_string(),
            harness: json!({
                "session_id": "session-test",
                "title": "Test",
                "model": "model",
                "provider": "openai",
                "run_state": "idle",
                "updated_at_ms": 100,
            }),
        };
        let mut tracker = HaiderBridgeReconcileTracker::default();
        let mut heads = HashMap::from([(session.id.clone(), 7)]);
        let writes = std::cell::Cell::new(0);
        let mut reconcile = |_: Option<&[HaiderBridgeSession]>, _: &[HaiderBridgeSession]| {
            writes.set(writes.get() + 1);
            Ok(false)
        };

        assert!(!haider_bridge_reconcile_tracked(
            &mut tracker,
            std::slice::from_ref(&session),
            &heads,
            false,
            &mut reconcile,
        )
        .unwrap());
        assert_eq!(writes.get(), 1);
        assert!(!haider_bridge_reconcile_tracked(
            &mut tracker,
            std::slice::from_ref(&session),
            &heads,
            false,
            &mut reconcile,
        )
        .unwrap());
        assert_eq!(writes.get(), 1);

        heads.insert(session.id.clone(), 8);
        haider_bridge_reconcile_tracked(
            &mut tracker,
            std::slice::from_ref(&session),
            &heads,
            false,
            &mut reconcile,
        )
        .unwrap();
        assert_eq!(writes.get(), 2);

        let mut raw_changed = session.clone();
        raw_changed.harness["run_state"] = json!({"status": "running_tool", "tool": "cargo"});
        haider_bridge_reconcile_tracked(
            &mut tracker,
            std::slice::from_ref(&raw_changed),
            &heads,
            false,
            &mut reconcile,
        )
        .unwrap();
        assert_eq!(writes.get(), 3);

        heads.clear();
        for _ in 0..2 {
            haider_bridge_reconcile_tracked(
                &mut tracker,
                std::slice::from_ref(&raw_changed),
                &heads,
                false,
                &mut reconcile,
            )
            .unwrap();
        }
        assert_eq!(writes.get(), 5);
    }

    #[test]
    fn haider_bridge_complete_roster_reconciles_unchanged_for_maintenance() {
        let session = HaiderBridgeSession {
            id: "session-maintenance".to_string(),
            harness: json!({"session_id": "session-maintenance", "head_seq": 7}),
        };
        let heads = HashMap::from([(session.id.clone(), 7)]);
        let mut tracker = HaiderBridgeReconcileTracker::default();
        let calls = std::cell::RefCell::new(Vec::new());

        for _ in 0..2 {
            haider_bridge_reconcile_tracked(
                &mut tracker,
                std::slice::from_ref(&session),
                &heads,
                true,
                |roster, candidates| {
                    calls
                        .borrow_mut()
                        .push((roster.map(<[HaiderBridgeSession]>::len), candidates.len()));
                    Ok(false)
                },
            )
            .unwrap();
        }

        assert_eq!(*calls.borrow(), vec![(Some(1), 1), (Some(1), 0)]);
    }

    #[test]
    fn haider_bridge_complete_rpc_snapshot_cannot_regress_a_newer_delta() {
        let newer = HaiderBridgeSession {
            id: "session-stale-seed".to_string(),
            harness: json!({
                "session_id": "session-stale-seed",
                "head_seq": 9,
                "title": "newer delta"
            }),
        };
        let stale = HaiderBridgeSession {
            id: newer.id.clone(),
            harness: json!({
                "session_id": "session-stale-seed",
                "head_seq": 8,
                "title": "stale seed page"
            }),
        };
        let mut tracker = HaiderBridgeReconcileTracker::default();

        haider_bridge_reconcile_tracked(
            &mut tracker,
            std::slice::from_ref(&newer),
            &HashMap::from([(newer.id.clone(), 9)]),
            false,
            |_, candidates| {
                assert_eq!(candidates, std::slice::from_ref(&newer));
                Ok(false)
            },
        )
        .unwrap();
        haider_bridge_reconcile_tracked(
            &mut tracker,
            std::slice::from_ref(&stale),
            &HashMap::from([(stale.id.clone(), 8)]),
            true,
            |roster, candidates| {
                assert!(roster.is_some());
                assert!(candidates.is_empty());
                Ok(false)
            },
        )
        .unwrap();

        assert_eq!(tracker.sessions[&newer.id].head_seq, Some(9));
        assert_eq!(tracker.sessions[&newer.id].harness["title"], "newer delta");
    }

    #[test]
    fn haider_bridge_push_and_full_summaries_share_apply_and_skip_logic() {
        let mut full_tracker = HaiderBridgeReconcileTracker::default();
        let mut push_tracker = HaiderBridgeReconcileTracker::default();
        let full_calls = std::cell::RefCell::new(Vec::new());
        let push_calls = std::cell::RefCell::new(Vec::new());

        for head_seq in [4, 4, 5] {
            let full = json!({
                "sessions": [{
                    "session_id":"session-shared",
                    "head_seq":head_seq,
                    "title":"Shared",
                    "model":"model",
                    "state":"idle",
                    "updated_at_ms":100
                }]
            });
            let push = json!({
                "session_id":"session-shared",
                "head_seq":head_seq,
                "title":"Shared",
                "last_model":"model"
            });
            haider_bridge_reconcile_summary_values_tracked(
                &mut full_tracker,
                vec![full],
                true,
                |_, candidates| {
                    full_calls.borrow_mut().push(
                        candidates
                            .iter()
                            .map(|session| session.id.clone())
                            .collect::<Vec<_>>(),
                    );
                    Ok(false)
                },
            )
            .unwrap();
            haider_bridge_reconcile_summary_values_tracked(
                &mut push_tracker,
                vec![push],
                false,
                |_, candidates| {
                    push_calls.borrow_mut().push(
                        candidates
                            .iter()
                            .map(|session| session.id.clone())
                            .collect::<Vec<_>>(),
                    );
                    Ok(false)
                },
            )
            .unwrap();
        }
        haider_bridge_reconcile_summary_values_tracked(
            &mut push_tracker,
            vec![json!({
                "session_id":"session-shared",
                "head_seq":3,
                "title":"stale title",
                "last_model":"stale-model"
            })],
            false,
            |_, candidates| {
                push_calls.borrow_mut().push(
                    candidates
                        .iter()
                        .map(|session| session.id.clone())
                        .collect::<Vec<_>>(),
                );
                Ok(false)
            },
        )
        .unwrap();

        assert_eq!(
            full_calls.borrow().as_slice(),
            &[
                vec!["session-shared".to_string()],
                Vec::new(),
                vec!["session-shared".to_string()]
            ]
        );
        let push_calls = push_calls.borrow();
        assert_eq!(push_calls.len(), 2);
        assert_eq!(push_calls[0], vec!["session-shared".to_string()]);
        assert_eq!(push_calls[1], vec!["session-shared".to_string()]);
        assert_eq!(push_tracker.sessions["session-shared"].head_seq, Some(5));
    }

    #[test]
    fn haider_bridge_reconcile_enqueues_changed_sessions_deduped() {
        let mut tracker = HaiderBridgeReconcileTracker::default();
        let enqueued = std::cell::RefCell::new(Vec::new());
        let initial = json!({
            "sessions": [
                {"session_id":"a", "head_seq":1},
                {"session_id":"a", "head_seq":1},
                {"session_id":"b", "head_seq":1},
                {"session_id":"c", "head_seq":1}
            ]
        });
        haider_bridge_reconcile_summary_values_prefold(
            &mut tracker,
            vec![initial.clone()],
            true,
            |_, _| Ok(true),
            |sessions| enqueued.borrow_mut().push(sessions),
        )
        .unwrap();
        haider_bridge_reconcile_summary_values_prefold(
            &mut tracker,
            vec![initial],
            true,
            |_, _| Ok(false),
            |sessions| enqueued.borrow_mut().push(sessions),
        )
        .unwrap();
        haider_bridge_reconcile_summary_values_prefold(
            &mut tracker,
            vec![json!({
                "sessions": [
                    {"session_id":"a", "head_seq":2},
                    {"session_id":"c", "head_seq":2}
                ]
            })],
            false,
            |_, _| Ok(true),
            |sessions| enqueued.borrow_mut().push(sessions),
        )
        .unwrap();

        assert_eq!(
            enqueued.into_inner(),
            vec![
                vec!["a".to_string(), "b".to_string(), "c".to_string()],
                vec!["a".to_string(), "c".to_string()]
            ]
        );
    }

    #[test]
    fn haider_library_honors_snapshot_availability_and_published_model_details() {
        let providers = json!([{
            "provider": "openai",
            "availability": "available",
            "enabled": true,
            "models": ["gpt-test"],
            "model_details": [{
                "name": "gpt-test",
                "supported_efforts": ["low", "high"],
                "supported_speeds": ["normal", "fast"]
            }]
        }]);
        let providers = providers.as_array().unwrap();
        let models = haider_library_catalog_models(
            providers,
            Some(&haider_rpc_ade::SnapshotAvailabilityWire::Available),
        );
        assert_eq!(
            models,
            vec![HaiderLibraryModel {
                model: "gpt-test".to_string(),
                provider: "openai".to_string(),
                available: true,
                legacy_availability: false,
                supported_efforts: vec!["low".to_string(), "high".to_string()],
                supported_speeds: vec!["normal".to_string(), "fast".to_string()],
            }]
        );
        assert!(haider_library_catalog_models(
            providers,
            Some(&haider_rpc_ade::SnapshotAvailabilityWire::Unavailable {
                reason: "registry_down".to_string(),
            }),
        )
        .is_empty());
        assert!(haider_library_catalog_models(
            providers,
            Some(&haider_rpc_ade::SnapshotAvailabilityWire::Unknown),
        )
        .is_empty());
    }
}

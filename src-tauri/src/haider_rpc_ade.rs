//! Minimal ADE client for Haider's daemon-owned volatile session surfaces.
//!
//! This module deliberately mirrors the stable JSON subset of `haider-rpc`
//! instead of depending on the Haider workspace. Unix-domain frames are a
//! four-byte big-endian body length followed by one negotiated `WireFrame`.

use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        OnceLock,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot, watch};
use zeroize::{Zeroize, Zeroizing};

#[cfg(unix)]
use std::{collections::VecDeque, future::Future, sync::Mutex as StdMutex};

#[cfg(unix)]
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::UnixStream,
    time::{Instant, MissedTickBehavior},
};

const WIRE_PROTOCOL_VERSION: u32 = 1;
const DEFAULT_FRAME_LIMIT: usize = 48 * 1024 * 1024;
const FEATURE_INPUT_MIRROR_V1: &str = "input_mirror_v1";
const FEATURE_INPUT_MIRROR_ATTACHMENTS_V1: &str = "input_mirror_attachments_v1";
const FEATURE_STATUS_SEGMENT_V1: &str = "status_segment_v1";
const FEATURE_STATUS_SEGMENT_STRUCTURED_V1: &str = "status_segment_structured_v1";
const FEATURE_ARTIFACT_PUT_V1: &str = "artifact_put_v1";
const FEATURE_SESSION_LIST_WATCH_V1: &str = "session_list_watch_v1";
const FEATURE_SESSION_CONFIG_V1: &str = "session_config_v1";
const FEATURE_SESSION_OBSERVE_V1: &str = "session_observe_v1";
const FEATURE_SESSION_OBSERVE_BATCH_V1: &str = "session_observe_batch_v1";
const FEATURE_SESSION_FLEET_V1: &str = "session_fleet_v1";
const FEATURE_AGENT_MESSAGE_V1: &str = "agent_message_v1";
const FEATURE_SESSION_MODEL_SELECT_V1: &str = "session_model_select_v1";
const FEATURE_SESSION_EFFORT_SELECT_V1: &str = "session_effort_select_v1";
const FEATURE_SESSION_FAST_SELECT_V1: &str = "session_fast_select_v1";
const FEATURE_SESSION_ACCOUNT_SELECT_V1: &str = "session_account_select_v1";
const FEATURE_RESIDENT_TURN_SUBMIT_V1: &str = "resident_turn_submit_v1";
const FEATURE_QUEUE_CONTROL_V1: &str = "queue_control_v1";
const FEATURE_RESIDENT_SESSION_BINDING_V1: &str = "resident_session_binding_v1";
const FEATURE_SESSION_SEEN_V1: &str = "session_seen_v1";
const FEATURE_SESSION_NEEDS_INPUT_V1: &str = "session_needs_input_v1";
const FEATURE_COMMAND_DOOR_V1: &str = "command_door_v1";
const FEATURE_ACCOUNT_MANAGEMENT_V1: &str = "account_management_v1";
const FEATURE_ACCOUNT_LIST_WATCH_V1: &str = "account_list_watch_v1";
const FEATURE_ACCOUNT_LOGIN_API_V1: &str = "account_login_api_v1";
const FEATURE_ACCOUNT_OAUTH_PKCE_V1: &str = "account_oauth_pkce_v1";
const FEATURE_ACCOUNT_OAUTH_DEVICE_V1: &str = "account_oauth_device_v1";
const FEATURE_ACCOUNT_OAUTH_IMPORT_V1: &str = "account_oauth_import_v1";
const FEATURE_ACCOUNT_OAUTH_IMPORT_SOURCES_V1: &str = "account_oauth_import_sources_v1";
const FEATURE_ACCOUNT_DEVICE_DISCOVERY_V1: &str = "account_device_discovery_v1";
const FEATURE_VAULT_STAGE_V1: &str = "vault_stage_v1";
const FEATURE_PROVIDER_MANAGEMENT_V1: &str = "provider_management_v1";
const FEATURE_PROVIDER_MODELS_V1: &str = "provider_models_v1";
const FEATURE_USAGE_REPORT_V1: &str = "usage_report_v1";
const FEATURE_USAGE_HISTORY_V1: &str = "usage_history_v1";
const FEATURE_HAIDER_CODE_PLAN_STATUS_V1: &str = "haider_code_plan_status_v1";
const FEATURE_CONVERGENCE_GRAPH_V1: &str = "convergence_graph_v1";
const FEATURE_CONVERGENCE_GRAPH_V2: &str = "convergence_graph_v2";
const FEATURE_CONVERGENCE_GRAPH_V3: &str = "convergence_graph_v3";
const FEATURE_CONVERGENCE_GRAPH_V4: &str = "convergence_graph_v4";
const FEATURE_LOOM_V1: &str = "loom_v1";
const FEATURE_LOOM_PIPE_DAG_V1: &str = "loom_pipe_dag_v1";
const FEATURE_LOOM_CLI_PRESENCE_V1: &str = "loom_cli_presence_v1";
const FEATURE_WORKFLOW_CATALOG_V1: &str = "workflow_catalog_v1";
const FEATURE_WORKFLOW_INSTANCE_V1: &str = "workflow_instance_v1";
const FEATURE_WORKFLOW_GRAPH_V1: &str = "workflow_graph_v1";
const FEATURE_SESSION_WORKFLOW_STATE_V1: &str = "session_workflow_state_v1";
const FEATURE_TYPED_AGENT_INSTALL_V1: &str = "typed_agent_install_v1";
const FEATURE_TYPED_AGENT_INSTALL_CONTROL_V1: &str = "typed_agent_install_control_v1";
const FEATURE_TYPED_AGENT_INSTALL_CANCEL_V1: &str = "typed_agent_install_cancel_v1";
const FEATURE_LOOM_AUTHORING_V1: &str = "loom_authoring_v1";
const FEATURE_LOOM_REGISTRY_CAS_V1: &str = "loom_registry_cas_v1";
const FEATURE_LOOM_REGISTRY_ARCHIVE_V1: &str = "loom_registry_archive_v1";
const FEATURE_LOOM_VALIDATION_V1: &str = "loom_validation_v1";
const FEATURE_LOOM_REGISTRY_WATCH_V1: &str = "loom_registry_watch_v1";
const FEATURE_SESSION_AGENT_TYPE_SELECT_V1: &str = "session_agent_type_select_v1";
const FEATURE_SESSION_LINEAGE_V1: &str = "session_lineage_v1";
const FEATURE_SESSION_DESCENDANT_STREAM_V1: &str = "session_descendant_stream_v1";
const FEATURE_MONITOR_CONTROL_V1: &str = "monitor_control_v1";
const FEATURE_MONITOR_DELIVERY_V1: &str = "monitor_delivery_v1";
const FEATURE_SESSION_MUTATION_V1: &str = "session_mutation_v1";
const FEATURE_SESSION_PERMISSION_OVERRIDES_V1: &str = "session_permission_overrides_v1";
const FEATURE_AUTONOMOUS_INTERACTION_V1: &str = "autonomous_interaction_v1";
const FEATURE_SESSION_RENAME_V1: &str = "session_rename_v1";
const FEATURE_CONTEXT_COMPACTION_V1: &str = "context_compaction_v1";
const FEATURE_SESSION_FORK_V1: &str = "session_fork_v1";
const FEATURE_RUN_RETRY_V1: &str = "run_retry_v1";
const FEATURE_CHECKPOINT_V1: &str = "checkpoint_v1";
const HAIDER_ACCOUNTS_UNAVAILABLE: &str = "haider_accounts_unavailable";
const HAIDER_NEEDS_INPUT_UNAVAILABLE: &str = "haider_needs_input_unavailable";
const HAIDER_NEEDS_INPUT_NO_CONNECTION: &str = "haider_needs_input_no_connection";
const HAIDER_NEEDS_INPUT_FEATURE_MISSING: &str = "haider_needs_input_feature_missing";
const HAIDER_NEEDS_INPUT_RPC_FAILED: &str = "haider_needs_input_rpc_failed";
const HAIDER_NEEDS_INPUT_STALE: &str =
    "haider_needs_input_stale: This park moved on; re-read the card.";
const HAIDER_NEEDS_INPUT_ANSWER_UNCERTAIN: &str =
    "haider_needs_input_answer_uncertain: Answer may have landed; retrying is safe.";
const HAIDER_COMMAND_NO_CONNECTION: &str = "haider_command_no_connection";
const HAIDER_COMMAND_FEATURE_MISSING: &str = "haider_command_feature_missing";
const HAIDER_COMMAND_LIST_FAILED: &str = "haider_command_list_failed";
const HAIDER_COMMAND_INVOKE_FAILED: &str = "haider_command_invoke_failed";
const HAIDER_COMMAND_PARK_FAILED: &str = "haider_command_park_failed";
#[cfg(unix)]
const SESSION_ANSWER_MENU_REPLAY_LIMIT: usize = 64;
const MAX_ACCOUNT_RESTAGE_RETRIES: usize = 3;
/// `busy` is mailbox backpressure: retrying in the same microsecond spends
/// the whole ladder before the daemon can drain. One short breath per rung.
const ACCOUNT_RETRY_BACKOFF: Duration = Duration::from_millis(120);
const SURFACE_EVENT: &str = "session-surface";
const SESSION_QUEUE_CHANGED_EVENT: &str = "session-queue-changed";
const ACCOUNT_ROSTER_CHANGED_EVENT: &str = "account-roster-changed";
const RESIDENT_SESSION_BINDING_EVENT: &str = "resident-session-binding";
const TOKENOMICS_UPDATED_EVENT: &str = "diffforge://tokenomics-updated";
const MONITOR_DELIVERY_EVENT: &str = "monitor-delivery";
const MONITOR_DELIVERY_CAUGHT_UP_EVENT: &str = "monitor-delivery-caught-up";
const SESSION_DESCENDANT_STREAM_EVENT: &str = "session-descendant-stream";
const SESSION_DESCENDANT_REPAIR_EVENT: &str = "session-descendant-repair";
const LOOM_REGISTRY_DELTA_EVENT: &str = "loom-registry-delta";
const LOOM_REGISTRY_CAUGHT_UP_EVENT: &str = "loom-registry-caught-up";
const PROFILE_ID_TAG: &[u8] = b"haider-profile-id-v1\n";
const COMMAND_REPLY_TIMEOUT: Duration = Duration::from_secs(2);
const FEATURE_SNIFF_TIMEOUT: Duration = Duration::from_secs(2);

#[cfg(unix)]
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
#[cfg(unix)]
const PING_INTERVAL: Duration = Duration::from_secs(15);
#[cfg(unix)]
const PONG_DEADLINE: Duration = Duration::from_secs(45);

#[derive(Debug, Clone, Serialize)]
pub struct SurfaceCommandStatus {
    /// The command's required feature is available on the current connection.
    pub active: bool,
    /// The local actor accepted the operation. An offline attach remains
    /// accepted because it is replayed after reconnect; volatile publishes do
    /// not queue while offline.
    pub accepted: bool,
    pub input_mirror: bool,
    pub status_segment: bool,
}

/// Receipt returned when the daemon durably admits a resident turn.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ResidentTurnSubmit {
    pub session_id: String,
    pub run_id: String,
    pub accepted_seq: u64,
    pub disposition: SubmitDisposition,
}

/// Render-complete row returned by the daemon-owned held-message queue.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QueueRowWire {
    pub id: String,
    pub text: String,
    pub mode: DeliveryMode,
    pub ordinal: u32,
    pub created_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QueueListResult {
    pub session_id: String,
    pub revision: u64,
    #[serde(default)]
    pub rows: Vec<QueueRowWire>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct QueueMutationResult {
    pub session_id: String,
    pub id: String,
    pub revision: u64,
}

/// Structured Tauri rejection for queue operations. In particular, daemon
/// `ErrorData::RevisionConflict` remains an object all the way to JS.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct QueueCommandError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

/// Receipt returned when the daemon durably marks a session as seen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SessionSeen {
    pub session_id: String,
    pub seen_at_ms: u64,
    pub seen_seq: u64,
    pub worker_generation: u64,
}

/// Inclusive committed-journal coordinates used by `session.read`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct SessionReadRange {
    pub start_seq: u64,
    pub end_seq: u64,
}

/// Forward-compatible `session.read` result. Envelopes intentionally remain
/// raw JSON so a newer daemon can add payload and item kinds without making
/// the ADE projection reject the entire page.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct SessionReadResult {
    pub session_id: String,
    pub range: SessionReadRange,
    pub head_seq: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latest_context_footprint: Option<Value>,
    #[serde(default)]
    pub envelopes: Vec<Value>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum SnapshotAvailabilityWire {
    Available,
    Unavailable {
        #[serde(default)]
        reason: String,
    },
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AccountListResult {
    pub descriptors: Vec<Value>,
    pub revision: Option<u64>,
    pub provider_active: Vec<Value>,
    pub provider_defaults: Vec<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub availability: Option<SnapshotAvailabilityWire>,
    /// A successful point-in-time list is not evidence that its change feed
    /// is live. Surfaces retain the snapshot but must present it as possibly
    /// stale whenever this state is unavailable.
    pub watch: AccountRosterWatchState,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum AccountRosterWatchState {
    Live,
    Unavailable { reason: String },
}

impl AccountRosterWatchState {
    fn unavailable(reason: impl Into<String>) -> Self {
        Self::Unavailable {
            reason: reason.into(),
        }
    }
}

impl Default for AccountRosterWatchState {
    fn default() -> Self {
        Self::unavailable("The account roster watch has not been started for this window.")
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
struct AccountRosterChangedPayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    revision: Option<u64>,
    watch: AccountRosterWatchState,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ProviderListResult {
    pub providers: Vec<Value>,
    pub revision: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub availability: Option<SnapshotAvailabilityWire>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct UsageReportResult {
    pub report: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub availability: Option<SnapshotAvailabilityWire>,
}

/// Root-vs-delegated accounting lane published by usage-history v1.
///
/// Wire authority: `crates/haider-protocol/src/usage.rs:20-32`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UsageHistoryRoleV1 {
    #[default]
    Root,
    Subagent,
    #[serde(other)]
    Unknown,
}

/// Append-only lane dictionary entry. Every descriptor field is genuinely
/// optional: the daemon publishes anonymous keys such as `{ "id": 2 }`.
/// Storage callers must retain those `None`s rather than inventing identity.
///
/// Wire authority: `crates/haider-protocol/src/usage.rs:34-50`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UsageHistoryKeyV1 {
    pub id: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_family: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speed: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct UsageHistoryRowV1 {
    pub key_id: u32,
    pub role: UsageHistoryRoleV1,
    pub requests: u64,
    pub errors: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub reasoning_tokens: u64,
}

/// A present slot is sampled even if every row/counter is zero. The enclosing
/// day uses `None` for not-sampled instead.
///
/// Wire authority: `crates/haider-protocol/src/usage.rs:66-74`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct UsageHistorySlotV1 {
    #[serde(default)]
    pub rows: Vec<UsageHistoryRowV1>,
    #[serde(default)]
    pub subagents_spawned: u64,
}

/// Provider meter values are frozen point-in-time ledger facts. In
/// particular `basis_points` remains an integer and optional balances remain
/// optional end to end.
///
/// Wire authority: `crates/haider-protocol/src/usage.rs:76-104`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UsageHistoryMeterSampleV1 {
    pub account: String,
    pub window: String,
    pub basis_points: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resets_at_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grace_until_ms: Option<u64>,
    pub sampled_at_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credits: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hold: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stale: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UsageHistoryVersionChangeV1 {
    pub daemon_version: String,
    pub changed_at_ms: u64,
}

/// Device-local truth for one UTC day. `slots` is validated as exactly 96 by
/// the Tokenomics ingestion boundary so malformed payloads never become
/// ambiguous storage.
///
/// Wire authority: `crates/haider-protocol/src/usage.rs:113-128`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UsageHistoryDayV1 {
    pub date: String,
    pub device_id: String,
    #[serde(default)]
    pub backfilled: bool,
    #[serde(default)]
    pub keys: Vec<UsageHistoryKeyV1>,
    pub slots: Vec<Option<UsageHistorySlotV1>>,
    #[serde(default)]
    pub meter_samples: Vec<UsageHistoryMeterSampleV1>,
    #[serde(default)]
    pub version_changes: Vec<UsageHistoryVersionChangeV1>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct UsageHistoryDailyTotalV1 {
    pub sampled_slots: u16,
    pub requests: u64,
    pub errors: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub reasoning_tokens: u64,
    pub subagents_spawned: u64,
}

/// One absence-preserving range cell. `total: None` is not a zero total.
///
/// Wire authority: `crates/haider-protocol/src/usage.rs:145-152`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct UsageHistoryRangeDayV1 {
    pub date: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total: Option<UsageHistoryDailyTotalV1>,
}

/// A successful day RPC is still tri-state: feature absence, an absent day
/// with known device provenance, or a typed day payload.
///
/// Response authority: `crates/haider-rpc/src/frame.rs:2942-2950`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum UsageHistoryDayRead {
    Unsupported,
    NoDay {
        date: String,
        device_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        availability: Option<SnapshotAvailabilityWire>,
    },
    Day {
        date: String,
        device_id: String,
        day: UsageHistoryDayV1,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        availability: Option<SnapshotAvailabilityWire>,
    },
}

/// A typed bounded range or an explicit feature-unsupported state.
///
/// Response authority: `crates/haider-rpc/src/frame.rs:2952-2960`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum UsageHistoryRangeRead {
    Unsupported,
    Range {
        through_date: String,
        device_id: String,
        days: Vec<UsageHistoryRangeDayV1>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        availability: Option<SnapshotAvailabilityWire>,
    },
}

/// Last provider-authored Haider Code plan frame observed on the shared ADE
/// connection. `known=false` is deliberately distinct from a frame whose
/// snapshot omits `weekly_allowance.percent_remaining`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub(crate) struct HaiderCodePlanStatusSnapshot {
    /// `None` before a Welcome, `Some(false)` for an older daemon, and
    /// `Some(true)` once the publishing feature is advertised.
    pub supported: Option<bool>,
    pub known: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_alias: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcome: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub received_at_ms: Option<u64>,
}

impl HaiderCodePlanStatusSnapshot {
    fn for_features(features: &BTreeSet<String>, previous: &Self) -> Self {
        if features.contains(FEATURE_HAIDER_CODE_PLAN_STATUS_V1) {
            let mut snapshot = previous.clone();
            snapshot.supported = Some(true);
            snapshot
        } else {
            Self {
                supported: Some(false),
                ..Self::default()
            }
        }
    }

    #[cfg(not(unix))]
    fn unsupported() -> Self {
        Self {
            supported: Some(false),
            ..Self::default()
        }
    }
}

#[derive(Clone, Serialize)]
pub struct AccountOauthStartResult {
    pub availability: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flow_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authorization_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_origin: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loopback_port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at_ms: Option<u64>,
    pub attempt_id: String,
}

#[derive(Clone, Serialize)]
pub struct AccountOauthFlowResult {
    pub flow_id: String,
    pub status: Value,
}

#[derive(Clone, Serialize)]
pub struct AccountImportResult {
    pub descriptor: Value,
    pub revision: u64,
}

#[derive(Clone, Serialize)]
pub struct AccountDeviceCandidatesResult {
    pub discovery_disabled: bool,
    pub candidates: Vec<Value>,
}

#[derive(Clone, Serialize)]
pub struct AccountSetLabelResult {
    pub descriptor: Value,
    pub revision: u64,
}

#[derive(Clone, Serialize)]
pub struct AccountSetActiveResult {
    pub descriptor: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prior_alias: Option<String>,
    pub revision: u64,
}

#[derive(Clone, Serialize)]
pub struct AccountRemoveResult {
    pub removed_alias: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replacement_active_alias: Option<String>,
    pub revision: u64,
}

/// Stable fleet state from the daemon. Future string values remain available
/// to JS instead of collapsing into a client-invented state.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FleetAgentStateWire {
    Queued,
    Live,
    Waiting,
    Done,
    Failed,
    Cancelled,
    Unknown(String),
}

impl FleetAgentStateWire {
    fn as_wire_str(&self) -> &str {
        match self {
            Self::Queued => "queued",
            Self::Live => "live",
            Self::Waiting => "waiting",
            Self::Done => "done",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::Unknown(raw) => raw,
        }
    }
}

impl Serialize for FleetAgentStateWire {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_wire_str())
    }
}

impl<'de> Deserialize<'de> for FleetAgentStateWire {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = String::deserialize(deserializer)?;
        Ok(match raw.as_str() {
            "queued" => Self::Queued,
            "live" => Self::Live,
            "waiting" => Self::Waiting,
            "done" => Self::Done,
            "failed" => Self::Failed,
            "cancelled" => Self::Cancelled,
            _ => Self::Unknown(raw),
        })
    }
}

/// One bounded descendant. `metrics` remains the complete daemon-authored
/// record; only the fleet coordinates and completeness fields are mirrored.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FleetNodeWire {
    pub agent_id: String,
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub callsign: Option<String>,
    pub task: String,
    pub depth: u32,
    pub parent_session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_agent_id: Option<String>,
    pub state: FleetAgentStateWire,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metrics: Option<Value>,
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    pub folded_children: u32,
    #[serde(default)]
    pub children: Vec<FleetNodeWire>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FleetStateCountsWire {
    pub queued: u32,
    pub live: u32,
    pub waiting: u32,
    pub done: u32,
    pub failed: u32,
    pub cancelled: u32,
}

/// Totals over returned nodes only. Missing usage is typed absence because at
/// least one node lacks durable usage truth; it is never a zero total.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FleetMetricsTotalsWire {
    pub elapsed_ms: u64,
    pub tool_attempts: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FleetRollupWire {
    pub node_count: u32,
    pub states: FleetStateCountsWire,
    pub max_depth: u32,
    pub metrics: FleetMetricsTotalsWire,
    pub metrics_complete: bool,
    pub complete: bool,
}

/// Bounded point-in-time fleet truth. `truncated`, `complete`, and each
/// node's `folded_children` must be interpreted together by consumers.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SessionFleetSnapshot {
    pub session_id: String,
    pub generated_at_ms: u64,
    pub node_limit: u32,
    pub depth_limit: u32,
    #[serde(default)]
    pub roots: Vec<FleetNodeWire>,
    pub rollup: FleetRollupWire,
    pub truncated: bool,
}

/// One child-journal reconnect coordinate accepted from Tauri. The decimal
/// string keeps JavaScript from rounding a sequence above 2^53 before Rust
/// can checked-parse it for the daemon wire.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DescendantReplayCursor {
    pub session_id: String,
    pub agent_id: String,
    pub after_seq: String,
}

/// Daemon-facing form of a descendant replay cursor. Both lineage
/// coordinates remain mandatory and independent.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct DescendantReplayCursorWire {
    session_id: String,
    agent_id: String,
    after_seq: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DescendantIdentity {
    pub session_id: String,
    pub agent_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DescendantFanout {
    pub requested_children: u32,
    pub accepted_children: u32,
    pub hard_limit: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DescendantTruncation {
    pub truncated: bool,
    pub streamed_children: u32,
    pub omitted_children: u32,
    pub count_complete: bool,
}

fn descendant_sequence_field(field: &str) -> bool {
    field == "seq"
        || field.ends_with("_seq")
        || field == "sequence"
        || field.ends_with("_sequence")
        || field == "cursor"
        || field.ends_with("_cursor")
}

/// Preserve deep daemon records as JSON while converting sequence-bearing
/// unsigned integers at the Tauri boundary. Unknown node states, change
/// kinds, event variants, and additive fields are otherwise untouched.
fn descendant_tauri_value(value: &Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.iter().map(descendant_tauri_value).collect()),
        Value::Object(fields) => Value::Object(
            fields
                .iter()
                .map(|(field, value)| {
                    let value = if descendant_sequence_field(field) {
                        value
                            .as_u64()
                            .map(|sequence| Value::String(sequence.to_string()))
                            .unwrap_or_else(|| descendant_tauri_value(value))
                    } else {
                        descendant_tauri_value(value)
                    };
                    (field.clone(), value)
                })
                .collect(),
        ),
        _ => value.clone(),
    }
}

fn serialize_descendant_values<S>(values: &[Value], serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    values
        .iter()
        .map(descendant_tauri_value)
        .collect::<Vec<_>>()
        .serialize(serializer)
}

fn serialize_descendant_value<S>(value: &Value, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    descendant_tauri_value(value).serialize(serializer)
}

fn serialize_descendant_u64<S>(value: &u64, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serializer.collect_str(value)
}

/// Typed attachment baseline shell. Nodes stay raw so this SDK does not
/// become a second protocol enum implementation.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SessionDescendantBaseline {
    pub session_id: String,
    pub generated_at_ms: u64,
    pub fanout: DescendantFanout,
    pub truncation: DescendantTruncation,
    #[serde(default, serialize_with = "serialize_descendant_values")]
    pub roots: Vec<Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SessionDescendantsAttachment {
    pub attachment_id: String,
    pub baseline: SessionDescendantBaseline,
    /// SDK-local forwarding-loss counter sampled immediately before attach.
    /// It is not a daemon baseline field and never advances a child cursor.
    #[serde(serialize_with = "serialize_descendant_u64")]
    pub lost_events_at_attach: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
struct SessionDescendantStreamPayload {
    attachment_id: String,
    #[serde(serialize_with = "serialize_descendant_value")]
    event: Value,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct SessionDescendantRepairPayload {
    attachment_id: String,
    children: Vec<DescendantIdentity>,
}

impl Serialize for SessionDescendantRepairPayload {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serde_json::json!({
            "attachment_id": &self.attachment_id,
            "children": &self.children,
        })
        .serialize(serializer)
    }
}

/// How the daemon delivered one parent-authored child message. Unknown
/// strings cross the SDK boundary unchanged.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AgentMessageDeliveryWire {
    DeliveredSteer,
    DeliveredQueued,
    DeliveredSubturn,
    Unknown(String),
}

impl AgentMessageDeliveryWire {
    fn as_wire_str(&self) -> &str {
        match self {
            Self::DeliveredSteer => "delivered_steer",
            Self::DeliveredQueued => "delivered_queued",
            Self::DeliveredSubturn => "delivered_subturn",
            Self::Unknown(raw) => raw,
        }
    }
}

impl Serialize for AgentMessageDeliveryWire {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_wire_str())
    }
}

impl<'de> Deserialize<'de> for AgentMessageDeliveryWire {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = String::deserialize(deserializer)?;
        Ok(match raw.as_str() {
            "delivered_steer" => Self::DeliveredSteer,
            "delivered_queued" => Self::DeliveredQueued,
            "delivered_subturn" => Self::DeliveredSubturn,
            _ => Self::Unknown(raw),
        })
    }
}

/// Receipt run state. Scalar coordinates needed by the ADE are typed; nested
/// reason records stay verbatim, and an unknown future state retains its
/// complete object rather than losing additive fields.
#[derive(Clone, Debug, PartialEq)]
pub enum RunStateWire {
    Queued,
    Thinking,
    Streaming,
    RunningTool,
    Waiting {
        reason: Value,
    },
    Retrying {
        attempt: u32,
        max: u32,
        delay_ms: u64,
        reason: Value,
    },
    InputRequired {
        menu: String,
    },
    PermissionRequired {
        menu: String,
    },
    Compacting,
    Verifying {
        step: String,
    },
    Concluding,
    EffectOutcomeUnknown,
    Cancelling,
    Done,
    Errored,
    Cancelled,
    Unknown(Value),
}

impl Serialize for RunStateWire {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let raw = match self {
            Self::Queued => serde_json::json!({"state": "queued"}),
            Self::Thinking => serde_json::json!({"state": "thinking"}),
            Self::Streaming => serde_json::json!({"state": "streaming"}),
            Self::RunningTool => serde_json::json!({"state": "running_tool"}),
            Self::Waiting { reason } => {
                serde_json::json!({"state": "waiting", "reason": reason})
            }
            Self::Retrying {
                attempt,
                max,
                delay_ms,
                reason,
            } => serde_json::json!({
                "state": "retrying",
                "attempt": attempt,
                "max": max,
                "delay_ms": delay_ms,
                "reason": reason,
            }),
            Self::InputRequired { menu } => {
                serde_json::json!({"state": "input_required", "menu": menu})
            }
            Self::PermissionRequired { menu } => {
                serde_json::json!({"state": "permission_required", "menu": menu})
            }
            Self::Compacting => serde_json::json!({"state": "compacting"}),
            Self::Verifying { step } => {
                serde_json::json!({"state": "verifying", "step": step})
            }
            Self::Concluding => serde_json::json!({"state": "concluding"}),
            Self::EffectOutcomeUnknown => {
                serde_json::json!({"state": "effect_outcome_unknown"})
            }
            Self::Cancelling => serde_json::json!({"state": "cancelling"}),
            Self::Done => serde_json::json!({"state": "done"}),
            Self::Errored => serde_json::json!({"state": "errored"}),
            Self::Cancelled => serde_json::json!({"state": "cancelled"}),
            Self::Unknown(raw) => raw.clone(),
        };
        raw.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for RunStateWire {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = Value::deserialize(deserializer)?;
        let state = raw
            .get("state")
            .and_then(Value::as_str)
            .ok_or_else(|| serde::de::Error::custom("run state tag was missing"))?
            .to_string();
        let field = |name: &str| {
            raw.get(name)
                .cloned()
                .ok_or_else(|| serde::de::Error::custom(format!("run state {name} was missing")))
        };
        let string_field = |name: &str| {
            field(name)
                .and_then(|value| serde_json::from_value(value).map_err(serde::de::Error::custom))
        };
        let u32_field = |name: &str| {
            field(name)
                .and_then(|value| serde_json::from_value(value).map_err(serde::de::Error::custom))
        };
        let u64_field = |name: &str| {
            field(name)
                .and_then(|value| serde_json::from_value(value).map_err(serde::de::Error::custom))
        };
        Ok(match state.as_str() {
            "queued" => Self::Queued,
            "thinking" => Self::Thinking,
            "streaming" => Self::Streaming,
            "running_tool" => Self::RunningTool,
            "waiting" => Self::Waiting {
                reason: field("reason")?,
            },
            "retrying" => Self::Retrying {
                attempt: u32_field("attempt")?,
                max: u32_field("max")?,
                delay_ms: u64_field("delay_ms")?,
                reason: field("reason")?,
            },
            "input_required" => Self::InputRequired {
                menu: string_field("menu")?,
            },
            "permission_required" => Self::PermissionRequired {
                menu: string_field("menu")?,
            },
            "compacting" => Self::Compacting,
            "verifying" => Self::Verifying {
                step: string_field("step")?,
            },
            "concluding" => Self::Concluding,
            "effect_outcome_unknown" => Self::EffectOutcomeUnknown,
            "cancelling" => Self::Cancelling,
            "done" => Self::Done,
            "errored" => Self::Errored,
            "cancelled" => Self::Cancelled,
            _ => Self::Unknown(raw),
        })
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AgentMessageReceipt {
    pub agent: String,
    pub delivery: AgentMessageDeliveryWire,
    pub child_run_id: String,
    pub child_run_state: RunStateWire,
}

/// One daemon-owned Loom agent-type registry record. Every authoring field
/// remains verbatim; `rev` is the registry revision, never an availability
/// or install-readiness projection.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LoomAgentType {
    pub id: String,
    pub name: String,
    pub job: String,
    pub in_type: String,
    pub out_type: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub clis: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub apis: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skills: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scripts: Vec<String>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub color: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub glyph: String,
    pub rev: u32,
}

/// Registry class of an immutable workflow instance. Unknown future strings
/// cross the Rust/JS boundary unchanged.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WorkflowInstanceSourceV1 {
    BuiltIn,
    User,
    Unknown(String),
}

impl WorkflowInstanceSourceV1 {
    fn as_wire_str(&self) -> &str {
        match self {
            Self::BuiltIn => "built_in",
            Self::User => "user",
            Self::Unknown(raw) => raw,
        }
    }
}

impl Serialize for WorkflowInstanceSourceV1 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_wire_str())
    }
}

impl<'de> Deserialize<'de> for WorkflowInstanceSourceV1 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = String::deserialize(deserializer)?;
        Ok(match raw.as_str() {
            "built_in" => Self::BuiltIn,
            "user" => Self::User,
            _ => Self::Unknown(raw),
        })
    }
}

/// Exact daemon-owned workflow revision. Deep graph and Loom records remain
/// JSON values so the client never recompiles or re-mirrors authority data.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WorkflowInstanceV1 {
    pub id: String,
    pub revision: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
    pub template_digest: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pipe_version: Option<String>,
    pub source: WorkflowInstanceSourceV1,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node_metadata: Option<Value>,
    pub compiled_template: Value,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WorkflowInstanceResult {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub instance: Option<WorkflowInstanceV1>,
}

/// Daemon-owned activation-graph phase. Future phase strings cross the
/// Rust/JS boundary unchanged instead of being coerced to a known phase.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WorkflowGraphPhaseV1 {
    Active,
    Completed,
    Rejected,
    Unknown(String),
}

impl WorkflowGraphPhaseV1 {
    fn as_wire_str(&self) -> &str {
        match self {
            Self::Active => "active",
            Self::Completed => "completed",
            Self::Rejected => "rejected",
            Self::Unknown(raw) => raw,
        }
    }
}

impl Serialize for WorkflowGraphPhaseV1 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_wire_str())
    }
}

impl<'de> Deserialize<'de> for WorkflowGraphPhaseV1 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = String::deserialize(deserializer)?;
        Ok(match raw.as_str() {
            "active" => Self::Active,
            "completed" => Self::Completed,
            "rejected" => Self::Rejected,
            _ => Self::Unknown(raw),
        })
    }
}

fn serialize_workflow_graph_cursor<S>(cursor: &u64, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serializer.collect_str(cursor)
}

/// Scalar live-runtime graph coordinates typed by the ADE. The activation
/// AST and nested authority records remain verbatim JSON values.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WorkflowGraphStateV1 {
    pub graph_id: String,
    pub ast: Value,
    /// Daemon-issued topology fence; clients must never recompute it.
    pub ast_digest: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seed: Option<Value>,
    pub phase: WorkflowGraphPhaseV1,
    #[serde(serialize_with = "serialize_workflow_graph_cursor")]
    pub through_cursor: u64,
    pub next_activation_order: u64,
    pub back_edge_activations: u32,
    pub nodes: Vec<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub activation_order: Vec<Value>,
}

/// One cursor-bearing journal fact. The complete `type`-tagged fact remains
/// raw so unknown future event families survive unchanged.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WorkflowGraphWatchEventV1 {
    #[serde(serialize_with = "serialize_workflow_graph_cursor")]
    pub cursor: u64,
    pub event: Value,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WorkflowGraphWatchPageV1 {
    #[serde(serialize_with = "serialize_workflow_graph_cursor")]
    pub requested_after_cursor: u64,
    #[serde(serialize_with = "serialize_workflow_graph_cursor")]
    pub replay_through_cursor: u64,
    #[serde(serialize_with = "serialize_workflow_graph_cursor")]
    pub next_cursor: u64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub events: Vec<WorkflowGraphWatchEventV1>,
}

/// Monitor source family used by typed policy/rejection/report coordinates.
/// Complete source declarations remain raw JSON in registrations and requests.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MonitorSourceKindV1 {
    Sms,
    Process,
    File,
    Poll,
    Timer,
    Unknown(String),
}

impl MonitorSourceKindV1 {
    fn as_wire_str(&self) -> &str {
        match self {
            Self::Sms => "sms",
            Self::Process => "process",
            Self::File => "file",
            Self::Poll => "poll",
            Self::Timer => "timer",
            Self::Unknown(raw) => raw,
        }
    }
}

impl Serialize for MonitorSourceKindV1 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_wire_str())
    }
}

impl<'de> Deserialize<'de> for MonitorSourceKindV1 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = String::deserialize(deserializer)?;
        Ok(match raw.as_str() {
            "sms" => Self::Sms,
            "process" => Self::Process,
            "file" => Self::File,
            "poll" => Self::Poll,
            "timer" => Self::Timer,
            _ => Self::Unknown(raw),
        })
    }
}

/// Capability values in the monitor policy/rejection summary. Future values
/// retain their exact string instead of being folded into a unit fallback.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MonitorPolicyCapabilityV1 {
    View,
    Control,
    Unknown(String),
}

impl MonitorPolicyCapabilityV1 {
    fn as_wire_str(&self) -> &str {
        match self {
            Self::View => "view",
            Self::Control => "control",
            Self::Unknown(raw) => raw,
        }
    }
}

impl Serialize for MonitorPolicyCapabilityV1 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_wire_str())
    }
}

impl<'de> Deserialize<'de> for MonitorPolicyCapabilityV1 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = String::deserialize(deserializer)?;
        Ok(match raw.as_str() {
            "view" => Self::View,
            "control" => Self::Control,
            _ => Self::Unknown(raw),
        })
    }
}

/// Honest adapter state. Missing or future state tags never become Available;
/// unavailable reasons remain verbatim protocol data.
#[derive(Clone, Debug, PartialEq)]
pub enum MonitorSourceAvailabilityStateV1 {
    Available,
    Unavailable { reason: Option<Value> },
    Unknown { raw: Value },
}

impl Serialize for MonitorSourceAvailabilityStateV1 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::Available => serde_json::json!({"state": "available"}),
            Self::Unavailable { reason } => {
                let mut raw = serde_json::json!({"state": "unavailable"});
                if let Some(reason) = reason {
                    raw["reason"] = reason.clone();
                }
                raw
            }
            Self::Unknown { raw } => raw.clone(),
        }
        .serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for MonitorSourceAvailabilityStateV1 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = Value::deserialize(deserializer)?;
        Ok(match raw.get("state").and_then(Value::as_str) {
            Some("available") => Self::Available,
            Some("unavailable") => Self::Unavailable {
                reason: raw.get("reason").cloned(),
            },
            _ => Self::Unknown { raw },
        })
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MonitorSourceAvailabilityV1 {
    pub source: MonitorSourceKindV1,
    pub availability: MonitorSourceAvailabilityStateV1,
}

/// Descriptive policy echoed by every monitor receipt. Negotiated grants and
/// live attachment ownership remain the actual authorization authority.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MonitorControlPolicyV1 {
    pub list: MonitorPolicyCapabilityV1,
    pub register: MonitorPolicyCapabilityV1,
    pub register_requires_control_attachment: bool,
    pub remove: MonitorPolicyCapabilityV1,
    pub remove_requires_control_attachment: bool,
    pub watch: MonitorPolicyCapabilityV1,
}

/// Durable registry row. Deep source/filter/action vocabulary and occurrence
/// stay verbatim so the ADE never becomes a second monitor parser.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MonitorRegistrationV1 {
    pub monitor_id: String,
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    pub source: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter: Option<Value>,
    pub action: Value,
    pub occurrence: Value,
    pub created_at_ms: u64,
    pub start_source_sequence: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at_ms: Option<u64>,
}

fn monitor_u64_field(raw: &Value, field: &'static str) -> Result<u64, String> {
    let value = raw
        .get(field)
        .ok_or_else(|| format!("missing field `{field}`"))?;
    value
        .as_u64()
        .or_else(|| value.as_str().and_then(|decimal| decimal.parse().ok()))
        .ok_or_else(|| format!("field `{field}` must be a u64"))
}

/// Structured monitor refusal. Known reasons expose their recovery fields;
/// an unknown reason retains the complete raw object.
#[derive(Clone, Debug, PartialEq)]
pub enum MonitorControlRejectionV1 {
    CapabilityDenied {
        required: MonitorPolicyCapabilityV1,
    },
    ControlAttachmentRequired,
    SourceUnavailable {
        source: MonitorSourceKindV1,
    },
    LimitReached {
        count: u32,
        limit: u32,
    },
    NotFound {
        monitor_id: String,
    },
    SessionNotFound,
    StaleGeneration {
        requested: u64,
        current: u64,
    },
    CursorAhead {
        requested: u64,
        head: u64,
    },
    InvalidRequest {
        field: Option<String>,
        detail: String,
    },
    CommandConflict,
    ServiceStopped,
    StoreUnavailable {
        retryable: bool,
        detail: String,
    },
    Unknown {
        raw: Value,
    },
}

impl Serialize for MonitorControlRejectionV1 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let raw = match self {
            Self::CapabilityDenied { required } => serde_json::json!({
                "reason": "capability_denied",
                "required": required,
            }),
            Self::ControlAttachmentRequired => {
                serde_json::json!({"reason": "control_attachment_required"})
            }
            Self::SourceUnavailable { source } => serde_json::json!({
                "reason": "source_unavailable",
                "source": source,
            }),
            Self::LimitReached { count, limit } => serde_json::json!({
                "reason": "limit_reached",
                "count": count,
                "limit": limit,
            }),
            Self::NotFound { monitor_id } => serde_json::json!({
                "reason": "not_found",
                "monitor_id": monitor_id,
            }),
            Self::SessionNotFound => serde_json::json!({"reason": "session_not_found"}),
            Self::StaleGeneration { requested, current } => serde_json::json!({
                "reason": "stale_generation",
                "requested": requested,
                "current": current,
            }),
            Self::CursorAhead { requested, head } => serde_json::json!({
                "reason": "cursor_ahead",
                "requested": requested.to_string(),
                "head": head.to_string(),
            }),
            Self::InvalidRequest { field, detail } => {
                let mut raw = serde_json::json!({
                    "reason": "invalid_request",
                    "detail": detail,
                });
                if let Some(field) = field {
                    raw["field"] = Value::String(field.clone());
                }
                raw
            }
            Self::CommandConflict => serde_json::json!({"reason": "command_conflict"}),
            Self::ServiceStopped => serde_json::json!({"reason": "service_stopped"}),
            Self::StoreUnavailable { retryable, detail } => serde_json::json!({
                "reason": "store_unavailable",
                "retryable": retryable,
                "detail": detail,
            }),
            Self::Unknown { raw } => raw.clone(),
        };
        raw.serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for MonitorControlRejectionV1 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        struct CapabilityDeniedFields {
            required: MonitorPolicyCapabilityV1,
        }
        #[derive(Deserialize)]
        struct SourceUnavailableFields {
            source: MonitorSourceKindV1,
        }
        #[derive(Deserialize)]
        struct LimitReachedFields {
            count: u32,
            limit: u32,
        }
        #[derive(Deserialize)]
        struct NotFoundFields {
            monitor_id: String,
        }
        #[derive(Deserialize)]
        struct StaleGenerationFields {
            requested: u64,
            current: u64,
        }
        #[derive(Deserialize)]
        struct InvalidRequestFields {
            #[serde(default)]
            field: Option<String>,
            detail: String,
        }
        #[derive(Deserialize)]
        struct StoreUnavailableFields {
            retryable: bool,
            detail: String,
        }

        let raw = Value::deserialize(deserializer)?;
        match raw.get("reason").and_then(Value::as_str) {
            Some("capability_denied") => {
                let fields: CapabilityDeniedFields =
                    serde_json::from_value(raw).map_err(<D::Error as serde::de::Error>::custom)?;
                Ok(Self::CapabilityDenied {
                    required: fields.required,
                })
            }
            Some("control_attachment_required") => Ok(Self::ControlAttachmentRequired),
            Some("source_unavailable") => {
                let fields: SourceUnavailableFields =
                    serde_json::from_value(raw).map_err(<D::Error as serde::de::Error>::custom)?;
                Ok(Self::SourceUnavailable {
                    source: fields.source,
                })
            }
            Some("limit_reached") => {
                let fields: LimitReachedFields =
                    serde_json::from_value(raw).map_err(<D::Error as serde::de::Error>::custom)?;
                Ok(Self::LimitReached {
                    count: fields.count,
                    limit: fields.limit,
                })
            }
            Some("not_found") => {
                let fields: NotFoundFields =
                    serde_json::from_value(raw).map_err(<D::Error as serde::de::Error>::custom)?;
                Ok(Self::NotFound {
                    monitor_id: fields.monitor_id,
                })
            }
            Some("session_not_found") => Ok(Self::SessionNotFound),
            Some("stale_generation") => {
                let fields: StaleGenerationFields =
                    serde_json::from_value(raw).map_err(<D::Error as serde::de::Error>::custom)?;
                Ok(Self::StaleGeneration {
                    requested: fields.requested,
                    current: fields.current,
                })
            }
            Some("cursor_ahead") => Ok(Self::CursorAhead {
                requested: monitor_u64_field(&raw, "requested")
                    .map_err(<D::Error as serde::de::Error>::custom)?,
                head: monitor_u64_field(&raw, "head")
                    .map_err(<D::Error as serde::de::Error>::custom)?,
            }),
            Some("invalid_request") => {
                let fields: InvalidRequestFields =
                    serde_json::from_value(raw).map_err(<D::Error as serde::de::Error>::custom)?;
                Ok(Self::InvalidRequest {
                    field: fields.field,
                    detail: fields.detail,
                })
            }
            Some("command_conflict") => Ok(Self::CommandConflict),
            Some("service_stopped") => Ok(Self::ServiceStopped),
            Some("store_unavailable") => {
                let fields: StoreUnavailableFields =
                    serde_json::from_value(raw).map_err(<D::Error as serde::de::Error>::custom)?;
                Ok(Self::StoreUnavailable {
                    retryable: fields.retryable,
                    detail: fields.detail,
                })
            }
            _ => Ok(Self::Unknown { raw }),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum MonitorListOutcomeV1 {
    Listed {
        monitors: Vec<MonitorRegistrationV1>,
    },
    Rejected {
        rejection: MonitorControlRejectionV1,
    },
    Unknown {
        raw: Value,
    },
}

impl Serialize for MonitorListOutcomeV1 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::Listed { monitors } => serde_json::json!({
                "status": "listed",
                "monitors": monitors,
            }),
            Self::Rejected { rejection } => serde_json::json!({
                "status": "rejected",
                "rejection": rejection,
            }),
            Self::Unknown { raw } => raw.clone(),
        }
        .serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for MonitorListOutcomeV1 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        struct ListedFields {
            #[serde(default)]
            monitors: Vec<MonitorRegistrationV1>,
        }
        #[derive(Deserialize)]
        struct RejectedFields {
            rejection: MonitorControlRejectionV1,
        }

        let raw = Value::deserialize(deserializer)?;
        match raw.get("status").and_then(Value::as_str) {
            Some("listed") => {
                let fields: ListedFields =
                    serde_json::from_value(raw).map_err(<D::Error as serde::de::Error>::custom)?;
                Ok(Self::Listed {
                    monitors: fields.monitors,
                })
            }
            Some("rejected") => {
                let fields: RejectedFields =
                    serde_json::from_value(raw).map_err(<D::Error as serde::de::Error>::custom)?;
                Ok(Self::Rejected {
                    rejection: fields.rejection,
                })
            }
            _ => Ok(Self::Unknown { raw }),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum MonitorRegisterOutcomeV1 {
    Registered {
        monitor: MonitorRegistrationV1,
    },
    Rejected {
        rejection: MonitorControlRejectionV1,
    },
    Unknown {
        raw: Value,
    },
}

impl Serialize for MonitorRegisterOutcomeV1 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::Registered { monitor } => serde_json::json!({
                "status": "registered",
                "monitor": monitor,
            }),
            Self::Rejected { rejection } => serde_json::json!({
                "status": "rejected",
                "rejection": rejection,
            }),
            Self::Unknown { raw } => raw.clone(),
        }
        .serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for MonitorRegisterOutcomeV1 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        struct RegisteredFields {
            monitor: MonitorRegistrationV1,
        }
        #[derive(Deserialize)]
        struct RejectedFields {
            rejection: MonitorControlRejectionV1,
        }

        let raw = Value::deserialize(deserializer)?;
        match raw.get("status").and_then(Value::as_str) {
            Some("registered") => {
                let fields: RegisteredFields =
                    serde_json::from_value(raw).map_err(<D::Error as serde::de::Error>::custom)?;
                Ok(Self::Registered {
                    monitor: fields.monitor,
                })
            }
            Some("rejected") => {
                let fields: RejectedFields =
                    serde_json::from_value(raw).map_err(<D::Error as serde::de::Error>::custom)?;
                Ok(Self::Rejected {
                    rejection: fields.rejection,
                })
            }
            _ => Ok(Self::Unknown { raw }),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum MonitorRemoveOutcomeV1 {
    Removed {
        monitor_id: String,
    },
    Rejected {
        rejection: MonitorControlRejectionV1,
    },
    Unknown {
        raw: Value,
    },
}

impl Serialize for MonitorRemoveOutcomeV1 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::Removed { monitor_id } => serde_json::json!({
                "status": "removed",
                "monitor_id": monitor_id,
            }),
            Self::Rejected { rejection } => serde_json::json!({
                "status": "rejected",
                "rejection": rejection,
            }),
            Self::Unknown { raw } => raw.clone(),
        }
        .serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for MonitorRemoveOutcomeV1 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        struct RemovedFields {
            monitor_id: String,
        }
        #[derive(Deserialize)]
        struct RejectedFields {
            rejection: MonitorControlRejectionV1,
        }

        let raw = Value::deserialize(deserializer)?;
        match raw.get("status").and_then(Value::as_str) {
            Some("removed") => {
                let fields: RemovedFields =
                    serde_json::from_value(raw).map_err(<D::Error as serde::de::Error>::custom)?;
                Ok(Self::Removed {
                    monitor_id: fields.monitor_id,
                })
            }
            Some("rejected") => {
                let fields: RejectedFields =
                    serde_json::from_value(raw).map_err(<D::Error as serde::de::Error>::custom)?;
                Ok(Self::Rejected {
                    rejection: fields.rejection,
                })
            }
            _ => Ok(Self::Unknown { raw }),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum MonitorWatchOutcomeV1 {
    Watching {
        watch_id: String,
        requested_after_cursor: u64,
        replay_through_cursor: u64,
    },
    Rejected {
        rejection: MonitorControlRejectionV1,
    },
    Unknown {
        raw: Value,
    },
}

impl Serialize for MonitorWatchOutcomeV1 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::Watching {
                watch_id,
                requested_after_cursor,
                replay_through_cursor,
            } => serde_json::json!({
                "status": "watching",
                "watch_id": watch_id,
                "requested_after_cursor": requested_after_cursor.to_string(),
                "replay_through_cursor": replay_through_cursor.to_string(),
            }),
            Self::Rejected { rejection } => serde_json::json!({
                "status": "rejected",
                "rejection": rejection,
            }),
            Self::Unknown { raw } => raw.clone(),
        }
        .serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for MonitorWatchOutcomeV1 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        struct RejectedFields {
            rejection: MonitorControlRejectionV1,
        }

        let raw = Value::deserialize(deserializer)?;
        match raw.get("status").and_then(Value::as_str) {
            Some("watching") => {
                let watch_id = raw
                    .get("watch_id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| serde::de::Error::missing_field("watch_id"))?
                    .to_string();
                Ok(Self::Watching {
                    watch_id,
                    requested_after_cursor: monitor_u64_field(&raw, "requested_after_cursor")
                        .map_err(<D::Error as serde::de::Error>::custom)?,
                    replay_through_cursor: monitor_u64_field(&raw, "replay_through_cursor")
                        .map_err(<D::Error as serde::de::Error>::custom)?,
                })
            }
            Some("rejected") => {
                let fields: RejectedFields =
                    serde_json::from_value(raw).map_err(<D::Error as serde::de::Error>::custom)?;
                Ok(Self::Rejected {
                    rejection: fields.rejection,
                })
            }
            _ => Ok(Self::Unknown { raw }),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MonitorListReceiptV1 {
    pub session_id: String,
    pub policy: MonitorControlPolicyV1,
    pub sources: Vec<MonitorSourceAvailabilityV1>,
    pub outcome: MonitorListOutcomeV1,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MonitorRegisterReceiptV1 {
    pub command_id: String,
    pub session_id: String,
    pub worker_generation: u64,
    pub policy: MonitorControlPolicyV1,
    pub sources: Vec<MonitorSourceAvailabilityV1>,
    pub outcome: MonitorRegisterOutcomeV1,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MonitorRemoveReceiptV1 {
    pub command_id: String,
    pub session_id: String,
    pub worker_generation: u64,
    pub policy: MonitorControlPolicyV1,
    pub sources: Vec<MonitorSourceAvailabilityV1>,
    pub outcome: MonitorRemoveOutcomeV1,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MonitorWatchReceiptV1 {
    pub session_id: String,
    pub policy: MonitorControlPolicyV1,
    pub sources: Vec<MonitorSourceAvailabilityV1>,
    pub outcome: MonitorWatchOutcomeV1,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MonitorReportStatusV1 {
    Matched,
    RateLimited,
    TimedOut,
    Unknown(String),
}

impl MonitorReportStatusV1 {
    fn as_wire_str(&self) -> &str {
        match self {
            Self::Matched => "matched",
            Self::RateLimited => "rate_limited",
            Self::TimedOut => "timed_out",
            Self::Unknown(raw) => raw,
        }
    }
}

impl Serialize for MonitorReportStatusV1 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_wire_str())
    }
}

impl<'de> Deserialize<'de> for MonitorReportStatusV1 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = String::deserialize(deserializer)?;
        Ok(match raw.as_str() {
            "matched" => Self::Matched,
            "rate_limited" => Self::RateLimited,
            "timed_out" => Self::TimedOut,
            _ => Self::Unknown(raw),
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MonitorDeliveryDedupeV1 {
    pub delivery_key: String,
    pub report_key: String,
}

fn serialize_monitor_cursor<S>(cursor: &u64, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serializer.collect_str(cursor)
}

fn deserialize_monitor_cursor<'de, D>(deserializer: D) -> Result<u64, D::Error>
where
    D: Deserializer<'de>,
{
    let raw = Value::deserialize(deserializer)?;
    raw.as_u64()
        .or_else(|| raw.as_str().and_then(|decimal| decimal.parse().ok()))
        .ok_or_else(|| serde::de::Error::custom("monitor cursor must be a decimal u64"))
}

/// Dedicated durable report record. Source events and the copied action stay
/// raw; identity, grouping, omission, status, and cursor coordinates are typed.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MonitorDeliveryReportV1 {
    pub report_id: String,
    pub monitor_id: String,
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    pub source: MonitorSourceKindV1,
    pub status: MonitorReportStatusV1,
    #[serde(default)]
    pub events: Vec<Value>,
    pub coalesced_count: u64,
    pub omitted_count: u64,
    pub action: Value,
    #[serde(
        serialize_with = "serialize_monitor_cursor",
        deserialize_with = "deserialize_monitor_cursor"
    )]
    pub cursor: u64,
    pub dedupe: MonitorDeliveryDedupeV1,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct MonitorDeliveryEventV1 {
    pub watch_id: String,
    pub report: MonitorDeliveryReportV1,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct MonitorDeliveryCaughtUpEventV1 {
    pub watch_id: String,
    pub session_id: String,
    #[serde(serialize_with = "serialize_monitor_cursor")]
    pub high_water_cursor: u64,
}

/// Built-in and user catalog entries retain their complete nested authority
/// records. An unknown origin retains the complete raw object as well.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WorkflowCatalogEntryV1 {
    BuiltIn {
        id: String,
        main_session_eligible: bool,
        template: Value,
    },
    User {
        id: String,
        main_session_eligible: bool,
        workflow: Value,
    },
    Unknown(Value),
}

impl Serialize for WorkflowCatalogEntryV1 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::BuiltIn {
                id,
                main_session_eligible,
                template,
            } => serde_json::json!({
                "origin": "built_in",
                "id": id,
                "main_session_eligible": main_session_eligible,
                "template": template,
            })
            .serialize(serializer),
            Self::User {
                id,
                main_session_eligible,
                workflow,
            } => serde_json::json!({
                "origin": "user",
                "id": id,
                "main_session_eligible": main_session_eligible,
                "workflow": workflow,
            })
            .serialize(serializer),
            Self::Unknown(raw) => raw.serialize(serializer),
        }
    }
}

impl<'de> Deserialize<'de> for WorkflowCatalogEntryV1 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        struct BuiltInEntry {
            id: String,
            main_session_eligible: bool,
            template: Value,
        }

        #[derive(Deserialize)]
        struct UserEntry {
            id: String,
            main_session_eligible: bool,
            workflow: Value,
        }

        let raw = Value::deserialize(deserializer)?;
        match raw.get("origin").and_then(Value::as_str) {
            Some("built_in") => {
                let entry: BuiltInEntry =
                    serde_json::from_value(raw).map_err(<D::Error as serde::de::Error>::custom)?;
                Ok(Self::BuiltIn {
                    id: entry.id,
                    main_session_eligible: entry.main_session_eligible,
                    template: entry.template,
                })
            }
            Some("user") => {
                let entry: UserEntry =
                    serde_json::from_value(raw).map_err(<D::Error as serde::de::Error>::custom)?;
                Ok(Self::User {
                    id: entry.id,
                    main_session_eligible: entry.main_session_eligible,
                    workflow: entry.workflow,
                })
            }
            _ => Ok(Self::Unknown(raw)),
        }
    }
}

fn empty_json_array() -> Value {
    Value::Array(Vec::new())
}

fn value_is_empty_array(value: &Value) -> bool {
    value.as_array().is_some_and(Vec::is_empty)
}

fn is_zero_u32(value: &u32) -> bool {
    *value == 0
}

/// Scalar Convergence Graph coordinates used by the ADE. Nested graph
/// authority records are carried verbatim rather than duplicated here.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GraphStatus {
    pub graph_id: String,
    pub template: String,
    pub digest: String,
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    pub template_version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start_node: Option<String>,
    pub phase: String,
    pub current_node: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ready_nodes: Vec<String>,
    pub attempt: u32,
    pub nodes: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blocked_reason: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_menu: Option<Value>,
    #[serde(
        default = "empty_json_array",
        skip_serializing_if = "value_is_empty_array"
    )]
    pub pending_menus: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_set: Option<Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GraphInspectResult {
    pub snapshot: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GraphPinReceipt {
    pub session_id: String,
    pub graph_id: String,
    pub template: String,
    pub digest: String,
    pub pinned_seq: u64,
    pub opened_seq: u64,
    pub worker_generation: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GraphSwitchReceipt {
    pub session_id: String,
    pub old_graph_id: String,
    pub new_graph_id: String,
    pub template: String,
    pub digest: String,
    pub superseded_seq: u64,
    pub pinned_seq: u64,
    pub opened_seq: u64,
    pub worker_generation: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GraphAbandonReceipt {
    pub session_id: String,
    pub graph_id: String,
    pub abandoned_seq: u64,
    pub worker_generation: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GraphRunSetOpenReceipt {
    pub session_id: String,
    pub run_set_id: String,
    pub root_graph_id: String,
    pub plan_item_id: String,
    pub plan_event_seq: u64,
    pub template: String,
    pub digest: String,
    pub run_set_opened_seq: u64,
    pub through_seq: u64,
    #[serde(default = "empty_json_array")]
    pub children: Value,
    pub worker_generation: u64,
}

/// Typed recovery coordinates for a workflow selection fence mismatch.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkflowRevisionConflict {
    pub expected_digest: String,
    pub current_digest: String,
    pub current_revision: u32,
}

#[derive(Clone, Debug, PartialEq)]
pub enum WorkflowErrorData {
    WorkflowRevisionConflict(WorkflowRevisionConflict),
    Unknown(Value),
}

impl Serialize for WorkflowErrorData {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::WorkflowRevisionConflict(conflict) => serde_json::json!({
                "kind": "workflow_revision_conflict",
                "expected_digest": conflict.expected_digest,
                "current_digest": conflict.current_digest,
                "current_revision": conflict.current_revision,
            })
            .serialize(serializer),
            Self::Unknown(raw) => raw.serialize(serializer),
        }
    }
}

impl<'de> Deserialize<'de> for WorkflowErrorData {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = Value::deserialize(deserializer)?;
        if raw.get("kind").and_then(Value::as_str) == Some("workflow_revision_conflict") {
            let conflict =
                serde_json::from_value(raw).map_err(<D::Error as serde::de::Error>::custom)?;
            Ok(Self::WorkflowRevisionConflict(conflict))
        } else {
            Ok(Self::Unknown(raw))
        }
    }
}

/// Structured rejection for graph mutations and workflow registration.
/// Unknown error payloads, including future compile diagnostics, remain raw.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WorkflowCommandError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<WorkflowErrorData>,
}

/// Structured lifecycle rejection. Feature absence and transport absence stay
/// distinguishable, while daemon error data remains an opaque authority record.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LifecycleCommandError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

fn serialize_checkpoint_u64<S>(value: &u64, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serializer.collect_str(value)
}

/// A Tauri-safe checkpoint list cursor. The daemon wire is a JSON `u64`, but
/// JavaScript only ever sees and supplies its exact decimal spelling.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CheckpointCursorV1(pub u64);

impl Serialize for CheckpointCursorV1 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serialize_checkpoint_u64(&self.0, serializer)
    }
}

impl<'de> Deserialize<'de> for CheckpointCursorV1 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let decimal = String::deserialize(deserializer)?;
        if decimal.is_empty() || !decimal.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(serde::de::Error::custom(
                "checkpoint cursor must be a decimal u64 string",
            ));
        }
        decimal
            .parse::<u64>()
            .map(Self)
            .map_err(|_| serde::de::Error::custom("checkpoint cursor must be a decimal u64 string"))
    }
}

/// Forward-compatible checkpoint mutation category. Unknown daemon values
/// remain their exact wire strings instead of being coerced to a known kind.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CheckpointKindV1 {
    Edit,
    Write,
    Create,
    Delete,
    Move,
    Unknown(String),
}

impl CheckpointKindV1 {
    fn as_wire_str(&self) -> &str {
        match self {
            Self::Edit => "edit",
            Self::Write => "write",
            Self::Create => "create",
            Self::Delete => "delete",
            Self::Move => "move",
            Self::Unknown(raw) => raw,
        }
    }
}

impl Serialize for CheckpointKindV1 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_wire_str())
    }
}

impl<'de> Deserialize<'de> for CheckpointKindV1 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Ok(match String::deserialize(deserializer)?.as_str() {
            "edit" => Self::Edit,
            "write" => Self::Write,
            "create" => Self::Create,
            "delete" => Self::Delete,
            "move" => Self::Move,
            raw => Self::Unknown(raw.to_string()),
        })
    }
}

/// Forward-compatible origin of a checkpoint record.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub enum CheckpointOriginV1 {
    #[default]
    Tool,
    Undo,
    Redo,
    RollbackTurn,
    Unknown(String),
}

impl CheckpointOriginV1 {
    fn as_wire_str(&self) -> &str {
        match self {
            Self::Tool => "tool",
            Self::Undo => "undo",
            Self::Redo => "redo",
            Self::RollbackTurn => "rollback_turn",
            Self::Unknown(raw) => raw,
        }
    }
}

impl Serialize for CheckpointOriginV1 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_wire_str())
    }
}

impl<'de> Deserialize<'de> for CheckpointOriginV1 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Ok(match String::deserialize(deserializer)?.as_str() {
            "tool" => Self::Tool,
            "undo" => Self::Undo,
            "redo" => Self::Redo,
            "rollback_turn" => Self::RollbackTurn,
            raw => Self::Unknown(raw.to_string()),
        })
    }
}

/// Exact before/after state for one workspace-relative path.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CheckpointPathV1 {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pre_artifact: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pre_digest: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub post_digest: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub truncated_reason: Option<String>,
}

/// Tauri projection of one daemon-authored checkpoint fact. Numeric daemon
/// coordinates serialize as decimal strings; identity and digest absence is
/// kept typed rather than filled with sentinels.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CheckpointRecordedV1 {
    pub checkpoint_id: String,
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch_id: Option<String>,
    pub run_id: String,
    pub effect_id: String,
    pub call_id: String,
    #[serde(serialize_with = "serialize_checkpoint_u64")]
    pub seq: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_revision: Option<String>,
    pub kind: CheckpointKindV1,
    pub origin: CheckpointOriginV1,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_checkpoint_id: Option<String>,
    pub paths: Vec<CheckpointPathV1>,
    pub post_digest: String,
    #[serde(serialize_with = "serialize_checkpoint_u64")]
    pub recorded_at_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CheckpointListPageV1 {
    pub checkpoints: Vec<CheckpointRecordedV1>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<CheckpointCursorV1>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CheckpointMutationReceiptV1 {
    pub checkpoint: CheckpointRecordedV1,
    pub restored_checkpoint_ids: Vec<String>,
    #[serde(serialize_with = "serialize_checkpoint_u64")]
    pub worker_generation: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CheckpointConflictV1 {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_digest: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_digest: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CheckpointRollbackConflictV1 {
    pub verified: Vec<String>,
    pub conflicts: Vec<CheckpointConflictV1>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CheckpointBranchMismatchV1 {
    pub checkpoint_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkpoint_branch_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requested_branch_id: Option<String>,
}

/// Typed machine-readable checkpoint failure coordinates. Unknown future
/// variants remain raw JSON, but conflicts never collapse into a message.
#[derive(Clone, Debug, PartialEq)]
pub enum CheckpointErrorDataV1 {
    CheckpointConflict(CheckpointConflictV1),
    CheckpointRollbackConflict(CheckpointRollbackConflictV1),
    CheckpointBranchMismatch(CheckpointBranchMismatchV1),
    Unknown(Value),
}

impl Serialize for CheckpointErrorDataV1 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::CheckpointConflict(conflict) => serde_json::json!({
                "kind": "checkpoint_conflict",
                "conflict": conflict,
            })
            .serialize(serializer),
            Self::CheckpointRollbackConflict(conflict) => serde_json::json!({
                "kind": "checkpoint_rollback_conflict",
                "conflict": conflict,
            })
            .serialize(serializer),
            Self::CheckpointBranchMismatch(conflict) => serde_json::json!({
                "kind": "checkpoint_branch_mismatch",
                "checkpoint_id": conflict.checkpoint_id,
                "checkpoint_branch_id": conflict.checkpoint_branch_id,
                "requested_branch_id": conflict.requested_branch_id,
            })
            .serialize(serializer),
            Self::Unknown(raw) => raw.serialize(serializer),
        }
    }
}

impl<'de> Deserialize<'de> for CheckpointErrorDataV1 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = Value::deserialize(deserializer)?;
        match raw.get("kind").and_then(Value::as_str) {
            Some("checkpoint_conflict") => {
                #[derive(Deserialize)]
                struct Fields {
                    conflict: CheckpointConflictV1,
                }
                let fields: Fields =
                    serde_json::from_value(raw).map_err(<D::Error as serde::de::Error>::custom)?;
                Ok(Self::CheckpointConflict(fields.conflict))
            }
            Some("checkpoint_rollback_conflict") => {
                #[derive(Deserialize)]
                struct Fields {
                    conflict: CheckpointRollbackConflictV1,
                }
                let fields: Fields =
                    serde_json::from_value(raw).map_err(<D::Error as serde::de::Error>::custom)?;
                Ok(Self::CheckpointRollbackConflict(fields.conflict))
            }
            Some("checkpoint_branch_mismatch") => serde_json::from_value(raw)
                .map(Self::CheckpointBranchMismatch)
                .map_err(<D::Error as serde::de::Error>::custom),
            _ => Ok(Self::Unknown(raw)),
        }
    }
}

/// Structured checkpoint rejection returned through Tauri.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct CheckpointCommandError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<CheckpointErrorDataV1>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
struct CheckpointCursorWire(u64);

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct CheckpointRecordedWire {
    checkpoint_id: String,
    session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    branch_id: Option<String>,
    run_id: String,
    effect_id: String,
    call_id: String,
    seq: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    workspace_revision: Option<String>,
    kind: CheckpointKindV1,
    #[serde(default)]
    origin: CheckpointOriginV1,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    source_checkpoint_id: Option<String>,
    paths: Vec<CheckpointPathV1>,
    post_digest: String,
    recorded_at_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct CheckpointListPageWire {
    checkpoints: Vec<CheckpointRecordedWire>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    next_cursor: Option<CheckpointCursorWire>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct CheckpointMutationReceiptWire {
    checkpoint: CheckpointRecordedWire,
    restored_checkpoint_ids: Vec<String>,
    worker_generation: u64,
}

impl From<CheckpointRecordedWire> for CheckpointRecordedV1 {
    fn from(record: CheckpointRecordedWire) -> Self {
        Self {
            checkpoint_id: record.checkpoint_id,
            session_id: record.session_id,
            branch_id: record.branch_id,
            run_id: record.run_id,
            effect_id: record.effect_id,
            call_id: record.call_id,
            seq: record.seq,
            workspace_revision: record.workspace_revision,
            kind: record.kind,
            origin: record.origin,
            source_checkpoint_id: record.source_checkpoint_id,
            paths: record.paths,
            post_digest: record.post_digest,
            recorded_at_ms: record.recorded_at_ms,
        }
    }
}

impl From<CheckpointListPageWire> for CheckpointListPageV1 {
    fn from(page: CheckpointListPageWire) -> Self {
        Self {
            checkpoints: page.checkpoints.into_iter().map(Into::into).collect(),
            next_cursor: page
                .next_cursor
                .map(|checkpoint_cursor| CheckpointCursorV1(checkpoint_cursor.0)),
        }
    }
}

impl From<CheckpointMutationReceiptWire> for CheckpointMutationReceiptV1 {
    fn from(receipt: CheckpointMutationReceiptWire) -> Self {
        Self {
            checkpoint: receipt.checkpoint.into(),
            restored_checkpoint_ids: receipt.restored_checkpoint_ids,
            worker_generation: receipt.worker_generation,
        }
    }
}

fn serialize_lifecycle_u64<S>(value: &u64, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serializer.collect_str(value)
}

/// Daemon-issued durable coordinates of `session.create`.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SessionCreateReceipt {
    pub session_id: String,
    #[serde(serialize_with = "serialize_lifecycle_u64")]
    pub created_seq: u64,
    #[serde(serialize_with = "serialize_lifecycle_u64")]
    pub worker_generation: u64,
    /// `SessionMetadataV1` is deliberately not re-mirrored by this SDK.
    pub metadata: Value,
}

/// Daemon-normalized result of a receipted title mutation.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SessionRenameReceipt {
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(serialize_with = "serialize_lifecycle_u64")]
    pub renamed_seq: u64,
    #[serde(serialize_with = "serialize_lifecycle_u64")]
    pub worker_generation: u64,
}

/// Durable acceptance coordinates for main- or named-branch compaction.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SessionCompactReceipt {
    pub session_id: String,
    pub run_id: String,
    #[serde(serialize_with = "serialize_lifecycle_u64")]
    pub accepted_seq: u64,
    #[serde(serialize_with = "serialize_lifecycle_u64")]
    pub worker_generation: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch_id: Option<String>,
}

/// Stable coordinates of a complete daemon-owned session fork.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SessionForkReceipt {
    pub session_id: String,
    pub source_session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_branch_id: Option<String>,
    pub fork_node_id: String,
    #[serde(serialize_with = "serialize_lifecycle_u64")]
    pub fork_seq: u64,
    #[serde(serialize_with = "serialize_lifecycle_u64")]
    pub created_seq: u64,
    #[serde(serialize_with = "serialize_lifecycle_u64")]
    pub worker_generation: u64,
    /// `SessionMetadataV1` and prompt-fork additions remain verbatim records.
    pub metadata: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub forked_from: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub draft: Option<Value>,
}

/// Durable acceptance coordinates for retrying a failed run or live backoff.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RunRetryReceipt {
    pub session_id: String,
    pub run_id: String,
    pub failed_run_id: String,
    #[serde(serialize_with = "serialize_lifecycle_u64")]
    pub user_seq: u64,
    #[serde(serialize_with = "serialize_lifecycle_u64")]
    pub accepted_seq: u64,
    #[serde(serialize_with = "serialize_lifecycle_u64")]
    pub worker_generation: u64,
}

/// Agent-type registry plus point-in-time CLI inventory. Map absence is the
/// third state: no key means not probed, distinct from `Some(false)`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LoomListResult {
    #[serde(default)]
    pub agent_types: Vec<LoomAgentType>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub workflows: Vec<Value>,
    #[serde(default)]
    pub cli_present: BTreeMap<String, bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workflow_catalog: Option<Vec<WorkflowCatalogEntryV1>>,
    /// SDK request fact: only an explicit inclusive read can make an empty
    /// archive inventory authoritative. Omission preserves the shipped shape.
    #[serde(default, skip_serializing_if = "is_false")]
    pub include_archived: bool,
    /// Exact daemon-owned entry coordinates from an inclusive read. `None`
    /// means archive state was not requested, never that no entries exist.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archived_entries: Option<Vec<Value>>,
}

impl LoomListResult {
    #[must_use]
    pub fn cli_presence(&self, program: &str) -> Option<bool> {
        self.cli_present.get(program).copied()
    }
}

macro_rules! raw_string_enum {
    ($name:ident { $($variant:ident => $wire:literal),+ $(,)? }) => {
        #[derive(Clone, Debug, PartialEq, Eq)]
        pub enum $name {
            $($variant,)+
            Unknown(String),
        }

        impl Serialize for $name {
            fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
            where
                S: Serializer,
            {
                serializer.serialize_str(match self {
                    $(Self::$variant => $wire,)+
                    Self::Unknown(raw) => raw,
                })
            }
        }

        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
            where
                D: Deserializer<'de>,
            {
                let raw = String::deserialize(deserializer)?;
                Ok(match raw.as_str() {
                    $($wire => Self::$variant,)+
                    _ => Self::Unknown(raw),
                })
            }
        }
    };
}

raw_string_enum!(LoomAuthorKind {
    AgentType => "agent_type",
    Workflow => "workflow",
});

raw_string_enum!(LoomRegistryEntryKind {
    AgentType => "agent_type",
    Workflow => "workflow",
});

raw_string_enum!(TypedAgentInstallTerminalStateV1 {
    Succeeded => "succeeded",
    Failed => "failed",
    Cancelled => "cancelled",
});

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LoomAuthorLocation {
    /// Daemon coordinates are one-based and cross the SDK unchanged.
    pub line: u32,
    pub column: u32,
    pub field: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LoomAuthorValidationError {
    pub code: String,
    pub message: String,
    pub location: LoomAuthorLocation,
}

/// Deep authoring records stay opaque so this client does not reimplement
/// the independently versioned protocol document schemas.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LoomAuthorDraftResult {
    pub draft: Value,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LoomAuthorConfirmResult {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confirmed: Option<Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub errors: Vec<LoomAuthorValidationError>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LoomValidateResult {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub errors: Vec<LoomAuthorValidationError>,
    /// A non-mutating preview only. It is never promoted into a stored fact
    /// or reused by the SDK as a later mutation fence.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canonical_digest: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LoomRevisionExpectation {
    pub rev: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LoomRevisionConflict {
    pub expected: LoomRevisionExpectation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_rev: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_digest: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LoomAuthorRevisionConflict {
    pub expected_revision: u64,
    pub current_revision: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub enum LoomErrorData {
    LoomRevisionConflict(LoomRevisionConflict),
    AuthorRevisionConflict(LoomAuthorRevisionConflict),
    Unknown(Value),
}

impl Serialize for LoomErrorData {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::LoomRevisionConflict(conflict) => {
                #[derive(Serialize)]
                struct Wire<'a> {
                    kind: &'static str,
                    #[serde(flatten)]
                    conflict: &'a LoomRevisionConflict,
                }
                Wire {
                    kind: "loom_revision_conflict",
                    conflict,
                }
                .serialize(serializer)
            }
            Self::AuthorRevisionConflict(conflict) => serde_json::json!({
                "kind": "revision_conflict",
                "expected_revision": conflict.expected_revision,
                "current_revision": conflict.current_revision,
            })
            .serialize(serializer),
            Self::Unknown(raw) => raw.serialize(serializer),
        }
    }
}

impl<'de> Deserialize<'de> for LoomErrorData {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = Value::deserialize(deserializer)?;
        match raw.get("kind").and_then(Value::as_str) {
            Some("loom_revision_conflict") => serde_json::from_value(raw)
                .map(Self::LoomRevisionConflict)
                .map_err(serde::de::Error::custom),
            Some("revision_conflict") => serde_json::from_value(raw)
                .map(Self::AuthorRevisionConflict)
                .map_err(serde::de::Error::custom),
            _ => Ok(Self::Unknown(raw)),
        }
    }
}

/// Typed Loom rejection returned through Tauri. CAS conflicts keep their
/// expected/current coordinates instead of collapsing into display text.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct LoomCommandError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<LoomErrorData>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum LoomArchiveOutcome {
    Changed { entry: Value },
    Already { entry: Value },
    NotFound,
    Unknown { raw: Value },
}

impl Serialize for LoomArchiveOutcome {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::Changed { entry } => serde_json::json!({"status": "changed", "entry": entry}),
            Self::Already { entry } => serde_json::json!({"status": "already", "entry": entry}),
            Self::NotFound => serde_json::json!({"status": "not_found"}),
            Self::Unknown { raw } => raw.clone(),
        }
        .serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for LoomArchiveOutcome {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = Value::deserialize(deserializer)?;
        match raw.get("status").and_then(Value::as_str) {
            Some("changed") => Ok(Self::Changed {
                entry: raw
                    .get("entry")
                    .cloned()
                    .ok_or_else(|| serde::de::Error::missing_field("entry"))?,
            }),
            Some("already") => Ok(Self::Already {
                entry: raw
                    .get("entry")
                    .cloned()
                    .ok_or_else(|| serde::de::Error::missing_field("entry"))?,
            }),
            Some("not_found") => Ok(Self::NotFound),
            _ => Ok(Self::Unknown { raw }),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LoomArchiveReceipt {
    pub kind: LoomRegistryEntryKind,
    pub id: String,
    pub outcome: LoomArchiveOutcome,
}

#[derive(Clone, Debug, PartialEq)]
pub enum TypedAgentInstallCancelOutcome {
    Cancelled,
    AlreadyTerminal {
        state: TypedAgentInstallTerminalStateV1,
    },
    Unknown {
        raw: Value,
    },
}

impl Serialize for TypedAgentInstallCancelOutcome {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::Cancelled => serde_json::json!({"status": "cancelled"}),
            Self::AlreadyTerminal { state } => {
                serde_json::json!({"status": "already_terminal", "state": state})
            }
            Self::Unknown { raw } => raw.clone(),
        }
        .serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for TypedAgentInstallCancelOutcome {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = Value::deserialize(deserializer)?;
        match raw.get("status").and_then(Value::as_str) {
            Some("cancelled") => Ok(Self::Cancelled),
            Some("already_terminal") => {
                let state = raw
                    .get("state")
                    .cloned()
                    .ok_or_else(|| serde::de::Error::missing_field("state"))?;
                Ok(Self::AlreadyTerminal {
                    state: serde_json::from_value(state).map_err(serde::de::Error::custom)?,
                })
            }
            _ => Ok(Self::Unknown { raw }),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TypedAgentInstallCancelReceipt {
    pub install_job_id: String,
    pub outcome: TypedAgentInstallCancelOutcome,
}

fn loom_registry_cursor_field(field: &str) -> bool {
    field == "cursor" || field.ends_with("_cursor")
}

/// Preserve registry records and future fields while making every daemon
/// cursor safe at the JavaScript boundary.
fn loom_registry_tauri_value(value: &Value) -> Value {
    match value {
        Value::Array(values) => {
            Value::Array(values.iter().map(loom_registry_tauri_value).collect())
        }
        Value::Object(fields) => Value::Object(
            fields
                .iter()
                .map(|(field, value)| {
                    let value = if loom_registry_cursor_field(field) {
                        value
                            .as_u64()
                            .map(|cursor| Value::String(cursor.to_string()))
                            .unwrap_or_else(|| loom_registry_tauri_value(value))
                    } else {
                        loom_registry_tauri_value(value)
                    };
                    (field.clone(), value)
                })
                .collect(),
        ),
        _ => value.clone(),
    }
}

fn serialize_loom_registry_value<S>(value: &Value, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    loom_registry_tauri_value(value).serialize(serializer)
}

fn serialize_loom_cursor<S>(cursor: &u64, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serializer.collect_str(cursor)
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct LoomWatchResult {
    pub watch_id: String,
    #[serde(serialize_with = "serialize_loom_cursor")]
    pub requested_after_cursor: u64,
    #[serde(serialize_with = "serialize_loom_registry_value")]
    pub baseline: Value,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
struct LoomRegistryDeltaEvent {
    watch_id: String,
    #[serde(serialize_with = "serialize_loom_registry_value")]
    delta: Value,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
struct LoomRegistryCaughtUpEvent {
    watch_id: String,
    #[serde(serialize_with = "serialize_loom_cursor")]
    high_water_cursor: u64,
}

/// Flattened client receipt for `loom.register_agent_type`. The daemon's
/// opaque install coordinate is optional on the wire and must never be
/// synthesized from the registry id, revision, digest, or PATH inventory.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LoomRegistrationReceipt {
    pub id: String,
    pub rev: u32,
    pub digest: String,
    pub updated: bool,
    #[serde(default)]
    pub install_job_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct LoomRegistrationWire {
    id: String,
    rev: u32,
    digest: String,
    updated: bool,
}

/// Frozen 962 states plus a raw future value. Unknown strings survive the
/// Rust/JS boundary unchanged instead of disappearing into a unit fallback.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TypedAgentInstallState {
    Queued,
    Installing,
    Verifying,
    Succeeded,
    Failed,
    Unknown(String),
}

impl TypedAgentInstallState {
    fn as_wire_str(&self) -> &str {
        match self {
            Self::Queued => "queued",
            Self::Installing => "installing",
            Self::Verifying => "verifying",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::Unknown(raw) => raw,
        }
    }
}

impl Serialize for TypedAgentInstallState {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_wire_str())
    }
}

impl<'de> Deserialize<'de> for TypedAgentInstallState {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = String::deserialize(deserializer)?;
        Ok(match raw.as_str() {
            "queued" => Self::Queued,
            "installing" => Self::Installing,
            "verifying" => Self::Verifying,
            "succeeded" => Self::Succeeded,
            "failed" => Self::Failed,
            _ => Self::Unknown(raw),
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TypedAgentInstallProgress {
    pub total: u16,
    pub completed: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_cli: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TypedAgentInstallJob {
    pub job_id: String,
    pub agent_type_id: String,
    pub agent_type_rev: u32,
    pub agent_type_digest: String,
    pub state: TypedAgentInstallState,
    pub progress: TypedAgentInstallProgress,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TypedAgentRequiredCli {
    pub program: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TypedAgentInstallItem {
    pub job_id: String,
    pub ordinal: u16,
    pub required_cli: TypedAgentRequiredCli,
    pub state: TypedAgentInstallState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TypedAgentInstallStatus {
    #[serde(default)]
    pub jobs: Vec<TypedAgentInstallJob>,
    #[serde(default)]
    pub items: Vec<TypedAgentInstallItem>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TypedAgentInstallEvent {
    pub cursor: u64,
    pub job: TypedAgentInstallJob,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TypedAgentInstallRetryRejection {
    JobNotFound,
    StateNotRetryable { state: TypedAgentInstallState },
    ContractNotCurrent,
    Unknown { raw: Value },
}

impl Serialize for TypedAgentInstallRetryRejection {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::JobNotFound => serde_json::json!({"reason": "job_not_found"}),
            Self::StateNotRetryable { state } => {
                serde_json::json!({"reason": "state_not_retryable", "state": state})
            }
            Self::ContractNotCurrent => serde_json::json!({"reason": "contract_not_current"}),
            Self::Unknown { raw } => raw.clone(),
        }
        .serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for TypedAgentInstallRetryRejection {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = Value::deserialize(deserializer)?;
        match raw.get("reason").and_then(Value::as_str) {
            Some("job_not_found") => Ok(Self::JobNotFound),
            Some("state_not_retryable") => {
                let state = raw
                    .get("state")
                    .cloned()
                    .ok_or_else(|| serde::de::Error::missing_field("state"))?;
                Ok(Self::StateNotRetryable {
                    state: serde_json::from_value(state).map_err(serde::de::Error::custom)?,
                })
            }
            Some("contract_not_current") => Ok(Self::ContractNotCurrent),
            _ => Ok(Self::Unknown { raw }),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TypedAgentInstallRetryOutcome {
    Requeued {
        job: TypedAgentInstallJob,
    },
    Rejected {
        rejection: TypedAgentInstallRetryRejection,
    },
    Unknown {
        raw: Value,
    },
}

impl Serialize for TypedAgentInstallRetryOutcome {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::Requeued { job } => serde_json::json!({"status": "requeued", "job": job}),
            Self::Rejected { rejection } => {
                serde_json::json!({"status": "rejected", "rejection": rejection})
            }
            Self::Unknown { raw } => raw.clone(),
        }
        .serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for TypedAgentInstallRetryOutcome {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = Value::deserialize(deserializer)?;
        match raw.get("status").and_then(Value::as_str) {
            Some("requeued") => {
                let job = raw
                    .get("job")
                    .cloned()
                    .ok_or_else(|| serde::de::Error::missing_field("job"))?;
                Ok(Self::Requeued {
                    job: serde_json::from_value(job).map_err(serde::de::Error::custom)?,
                })
            }
            Some("rejected") => {
                let rejection = raw
                    .get("rejection")
                    .cloned()
                    .ok_or_else(|| serde::de::Error::missing_field("rejection"))?;
                Ok(Self::Rejected {
                    rejection: serde_json::from_value(rejection)
                        .map_err(serde::de::Error::custom)?,
                })
            }
            _ => Ok(Self::Unknown { raw }),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TypedAgentInstallRetryReceipt {
    pub job_id: String,
    pub outcome: TypedAgentInstallRetryOutcome,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TypedAgentInstallWatchRejection {
    JobNotFound,
    CursorAhead { requested: u64, head: u64 },
    Unknown { raw: Value },
}

impl Serialize for TypedAgentInstallWatchRejection {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::JobNotFound => serde_json::json!({"reason": "job_not_found"}),
            Self::CursorAhead { requested, head } => {
                serde_json::json!({"reason": "cursor_ahead", "requested": requested, "head": head})
            }
            Self::Unknown { raw } => raw.clone(),
        }
        .serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for TypedAgentInstallWatchRejection {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = Value::deserialize(deserializer)?;
        match raw.get("reason").and_then(Value::as_str) {
            Some("job_not_found") => Ok(Self::JobNotFound),
            Some("cursor_ahead") => {
                let requested = raw
                    .get("requested")
                    .and_then(Value::as_u64)
                    .ok_or_else(|| serde::de::Error::missing_field("requested"))?;
                let head = raw
                    .get("head")
                    .and_then(Value::as_u64)
                    .ok_or_else(|| serde::de::Error::missing_field("head"))?;
                Ok(Self::CursorAhead { requested, head })
            }
            _ => Ok(Self::Unknown { raw }),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TypedAgentInstallWatchOutcome {
    Watching {
        requested_after_cursor: u64,
        replay_through_cursor: u64,
        next_cursor: u64,
        events: Vec<TypedAgentInstallEvent>,
    },
    Rejected {
        rejection: TypedAgentInstallWatchRejection,
    },
    Unknown {
        raw: Value,
    },
}

impl Serialize for TypedAgentInstallWatchOutcome {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Self::Watching {
                requested_after_cursor,
                replay_through_cursor,
                next_cursor,
                events,
            } => {
                let mut raw = serde_json::json!({
                    "status": "watching",
                    "requested_after_cursor": requested_after_cursor,
                    "replay_through_cursor": replay_through_cursor,
                    "next_cursor": next_cursor,
                });
                if !events.is_empty() {
                    raw["events"] =
                        serde_json::to_value(events).map_err(serde::ser::Error::custom)?;
                }
                raw
            }
            Self::Rejected { rejection } => {
                serde_json::json!({"status": "rejected", "rejection": rejection})
            }
            Self::Unknown { raw } => raw.clone(),
        }
        .serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for TypedAgentInstallWatchOutcome {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let raw = Value::deserialize(deserializer)?;
        match raw.get("status").and_then(Value::as_str) {
            Some("watching") => {
                #[derive(Deserialize)]
                struct WatchingFields {
                    requested_after_cursor: u64,
                    replay_through_cursor: u64,
                    next_cursor: u64,
                    #[serde(default)]
                    events: Vec<TypedAgentInstallEvent>,
                }
                let fields: WatchingFields =
                    serde_json::from_value(raw).map_err(serde::de::Error::custom)?;
                Ok(Self::Watching {
                    requested_after_cursor: fields.requested_after_cursor,
                    replay_through_cursor: fields.replay_through_cursor,
                    next_cursor: fields.next_cursor,
                    events: fields.events,
                })
            }
            Some("rejected") => {
                let rejection = raw
                    .get("rejection")
                    .cloned()
                    .ok_or_else(|| serde::de::Error::missing_field("rejection"))?;
                Ok(Self::Rejected {
                    rejection: serde_json::from_value(rejection)
                        .map_err(serde::de::Error::custom)?,
                })
            }
            _ => Ok(Self::Unknown { raw }),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TypedAgentInstallWatchReceipt {
    pub job_id: String,
    pub outcome: TypedAgentInstallWatchOutcome,
}

/// Durable live-persona binding coordinates. This receipt does not claim
/// PATH presence, install success, executor readiness, a grant, or CLI scope.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionAgentTypePersonaBindingReceipt {
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_type: Option<String>,
    pub selected_seq: u64,
    pub worker_generation: u64,
}

#[derive(Clone, Serialize)]
pub struct AccountSetDefaultModelResult {
    pub provider_summary: Value,
    pub revision: u64,
}

impl SurfaceCommandStatus {
    fn inactive(accepted: bool) -> Self {
        Self {
            active: false,
            accepted,
            input_mirror: false,
            status_segment: false,
        }
    }

    #[cfg(unix)]
    fn from_connection(connection: &ConnectionSnapshot, active: bool, accepted: bool) -> Self {
        Self {
            active: connection.connected && active,
            accepted,
            input_mirror: connection.connected
                && connection.features.contains(FEATURE_INPUT_MIRROR_V1),
            status_segment: connection.connected
                && connection.features.contains(FEATURE_STATUS_SEGMENT_V1),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SurfaceInput {
    pub text: String,
    /// Metadata-only refs for ready composer attachments. The daemon does not
    /// retain local file names, so `name` is the stable artifact ref.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<SurfaceAttachment>,
    pub revision: u64,
    /// Daemon-stamped publisher connection id. Revision lanes are
    /// PER-CONNECTION, so the UI must discriminate self/foreign by owner —
    /// never by comparing revisions across lanes (rev934 P1-1).
    pub owner: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SurfaceAttachment {
    pub artifact: String,
    pub name: String,
    pub mime: String,
    pub size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SurfaceStatus {
    pub line: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    pub revision: u64,
}

#[derive(Debug, Clone, Serialize)]
struct SessionSurfacePayload {
    session_id: String,
    input: Option<SurfaceInput>,
    status: Option<SurfaceStatus>,
}

/// Cached authority and value for the daemon's unsolicited resident binding.
/// `supported: None` means no Welcome has established the authority yet;
/// `known: true, session_id: None` is the daemon's explicit unbound state.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct ResidentSessionBindingSnapshot {
    supported: Option<bool>,
    known: bool,
    session_id: Option<String>,
    worker_generation: Option<u64>,
}

impl ResidentSessionBindingSnapshot {
    fn for_features(features: &BTreeSet<String>) -> Self {
        Self {
            supported: Some(features.contains(FEATURE_RESIDENT_SESSION_BINDING_V1)),
            ..Self::default()
        }
    }

    #[cfg(not(unix))]
    fn legacy() -> Self {
        Self {
            supported: Some(false),
            ..Self::default()
        }
    }

    fn without_binding(&self) -> Self {
        Self {
            supported: self.supported,
            ..Self::default()
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum ClientKind {
    Gui,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Capability {
    View,
    Control,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Hello {
    protocol_min: u32,
    protocol_max: u32,
    #[serde(default)]
    client_name: String,
    #[serde(default)]
    client_version: String,
    #[serde(default)]
    client_instance_id: String,
    client_kind: ClientKind,
    #[serde(default)]
    capabilities_requested: BTreeSet<Capability>,
    #[serde(default = "default_frame_limit_u32")]
    max_receive_frame: u32,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    encodings: Vec<String>,
}

fn default_frame_limit_u32() -> u32 {
    DEFAULT_FRAME_LIMIT as u32
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct Welcome {
    protocol: u32,
    instance_id: String,
    daemon_generation: u64,
    frame_limit: u32,
    #[serde(default)]
    profile_id: String,
    #[serde(default)]
    daemon_version: String,
    lifecycle_phase: String,
    #[serde(default)]
    capabilities_granted: BTreeSet<Capability>,
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    features: BTreeSet<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    encoding: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct SurfaceInputPublishWire {
    text: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    attachments: Vec<SurfaceAttachmentWire>,
    revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct SurfaceStatusPublishWire {
    line: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    state: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
    revision: u64,
}

/// The daemon's metadata-only attachment shape. Names are intentionally not
/// on the wire: attachments are content-addressed CAS objects.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct SurfaceAttachmentWire {
    mime: String,
    bytes: u64,
    artifact: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct SurfaceInputWire {
    text: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    attachments: Vec<SurfaceAttachmentWire>,
    revision: u64,
    #[serde(default)]
    owner: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct SurfaceStatusWire {
    line: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    state: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
    revision: u64,
    #[serde(default)]
    owner: String,
}

/// A secret value is serialised as the daemon's transparent `SecretWire`, but
/// remains redacted in diagnostics and is zeroized when the request is done.
/// It must only be used on the authenticated local UDS actor path.
struct SecretWire(Zeroizing<String>);

impl SecretWire {
    fn new(secret: String) -> Self {
        Self(Zeroizing::new(secret))
    }

    fn wipe(&mut self) {
        self.0.zeroize();
    }
}

impl Clone for SecretWire {
    fn clone(&self) -> Self {
        Self(Zeroizing::new(self.0.to_string()))
    }
}

impl PartialEq for SecretWire {
    fn eq(&self, other: &Self) -> bool {
        self.0 == other.0
    }
}

impl Eq for SecretWire {}

impl std::fmt::Debug for SecretWire {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("SecretWire(REDACTED)")
    }
}

impl Serialize for SecretWire {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for SecretWire {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        String::deserialize(deserializer).map(Self::new)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum StagePurpose {
    ApiKey,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum AccountAddMethod {
    Oauth,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandKindWire {
    BuiltIn,
    Argument,
    Custom,
    #[default]
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandOwnershipWire {
    DaemonOperation,
    ClientView,
    #[default]
    #[serde(other)]
    Unknown,
}

/// Forward-compatible catalog row. `Argument` keeps the parent command in
/// name and the argument in value; neither Rust nor JS flattens it into a
/// second standalone command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommandCatalogItemWire {
    #[serde(default)]
    pub kind: CommandKindWire,
    #[serde(default)]
    pub ownership: CommandOwnershipWire,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub arg_hint: Option<String>,
    #[serde(default)]
    pub session_only: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CommandInvokeOutcomeWire {
    Receipt {
        receipt: Value,
    },
    Parked {
        needs_input: Value,
    },
    /// Kept opaque because the daemon may grow the client-owned command
    /// descriptor. JS rechecks ownership against the just-listed catalog
    /// before executing anything locally.
    ClientOwned {
        command: Value,
    },
    Unsupported {
        command: Value,
        #[serde(default)]
        reason: String,
    },
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "method")]
#[allow(unreachable_patterns)]
enum RequestBody {
    #[serde(rename = "command.list")]
    CommandList {
        query: String,
        in_session: bool,
        slots: Value,
    },
    #[serde(rename = "command.invoke")]
    CommandInvoke {
        command_id: String,
        command: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
    },
    #[serde(rename = "artifact.put")]
    ArtifactPut { data_base64: String },
    #[serde(rename = "session.create")]
    SessionCreate {
        command_id: String,
        cwd: String,
        provider: String,
        model: String,
        max_tokens: u64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        permission_overrides: Option<Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cache_policy: Option<Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        interaction_mode: Option<String>,
    },
    /// Opens the System Settings pane for an unresolved OS permission park.
    /// The daemon knows the pane; no URL is ever sent by a client. It opens on
    /// the machine running the DAEMON, which is the machine needing the grant.
    #[serde(rename = "computer.permission_open_settings")]
    ComputerPermissionOpenSettings {
        session_id: String,
        request_id: String,
        permission: String,
    },
    #[serde(rename = "session.list")]
    SessionList {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cursor: Option<String>,
        limit: u32,
    },
    #[serde(rename = "session.list_watch")]
    SessionListWatch {},
    #[serde(rename = "session.read")]
    SessionRead {
        session_id: String,
        range: SessionReadRange,
    },
    #[serde(rename = "provider.list")]
    ProviderList {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        provider: Option<String>,
    },
    #[serde(rename = "usage.report")]
    UsageReport {},
    /// Request authority: `crates/haider-rpc/src/frame.rs:2361-2367`.
    #[serde(rename = "usage.history_day")]
    UsageHistoryDay { date: String },
    #[serde(rename = "usage.history_range")]
    UsageHistoryRange { through_date: String, days: u16 },
    #[serde(rename = "loom.list")]
    LoomList {
        #[serde(default, skip_serializing_if = "is_false")]
        include_archived: bool,
    },
    #[cfg(test)]
    #[serde(rename = "loom.register_agent_type")]
    LoomRegisterAgentType { record: LoomAgentType },
    /// Additive CAS form kept separate so the shipped unit-level legacy
    /// constructor retains its exact source and serialized byte shape.
    #[serde(rename = "loom.register_agent_type")]
    LoomRegisterAgentTypeCas {
        record: LoomAgentType,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        expected_rev: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        expected_digest: Option<String>,
    },
    #[cfg(test)]
    #[serde(rename = "loom.register_workflow")]
    LoomRegisterWorkflow { source: String },
    #[serde(rename = "loom.register_workflow")]
    LoomRegisterWorkflowCas {
        source: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        expected_rev: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        expected_digest: Option<String>,
    },
    #[serde(rename = "loom.author.draft")]
    LoomAuthorDraft {
        session_id: String,
        kind: LoomAuthorKind,
        prose: String,
    },
    #[serde(rename = "loom.author.revise")]
    LoomAuthorRevise {
        authoring_id: String,
        expected_revision: u64,
        kind: LoomAuthorKind,
        text: String,
    },
    #[serde(rename = "loom.author.confirm")]
    LoomAuthorConfirm {
        authoring_id: String,
        expected_revision: u64,
        kind: LoomAuthorKind,
        text: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        expected_rev: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        expected_digest: Option<String>,
    },
    #[serde(rename = "loom.install.cancel")]
    LoomInstallCancel { install_job_id: String },
    #[serde(rename = "loom.archive")]
    LoomArchive {
        kind: LoomRegistryEntryKind,
        id: String,
        expected_rev: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        expected_digest: Option<String>,
    },
    #[serde(rename = "loom.unarchive")]
    LoomUnarchive {
        kind: LoomRegistryEntryKind,
        id: String,
        expected_rev: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        expected_digest: Option<String>,
    },
    #[serde(rename = "loom.validate")]
    LoomValidate { kind: LoomAuthorKind, text: String },
    #[serde(rename = "loom.watch")]
    LoomWatch { after_cursor: u64 },
    #[serde(rename = "workflow.instance")]
    WorkflowInstance {
        workflow_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        template_digest: Option<String>,
    },
    #[serde(rename = "workflow.graph.state")]
    WorkflowGraphState {
        session_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        graph_id: Option<String>,
    },
    #[serde(rename = "workflow.graph.watch")]
    WorkflowGraphWatch {
        session_id: String,
        after_cursor: u64,
        limit: u32,
    },
    /// Opens a reconnectable read-only stream over durable descendant
    /// journals. Every cursor is scoped by both child identities.
    #[serde(rename = "session.descendants.attach")]
    SessionDescendantsAttach {
        session_id: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        cursors: Vec<DescendantReplayCursorWire>,
        max_children: u32,
    },
    #[serde(rename = "monitor.list")]
    MonitorList { session_id: String },
    #[serde(rename = "monitor.register")]
    MonitorRegister {
        command_id: String,
        session_id: String,
        worker_generation: u64,
        source: Value,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        filter: Option<Value>,
        action: Value,
        occurrence: Value,
        lifetime: Value,
    },
    #[serde(rename = "monitor.remove")]
    MonitorRemove {
        command_id: String,
        session_id: String,
        worker_generation: u64,
        monitor_id: String,
    },
    #[serde(rename = "monitor.watch")]
    MonitorWatch {
        session_id: String,
        after_cursor: u64,
    },
    #[serde(rename = "graph.status")]
    GraphStatus { session_id: String },
    #[serde(rename = "graph.inspect")]
    GraphInspect {
        session_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cursor: Option<String>,
        limit: u32,
    },
    #[serde(rename = "graph.pin")]
    GraphPin {
        command_id: String,
        session_id: String,
        worker_generation: u64,
        template: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        expected_digest: Option<String>,
    },
    #[serde(rename = "graph.switch")]
    GraphSwitch {
        command_id: String,
        session_id: String,
        worker_generation: u64,
        old_graph_id: String,
        template: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        expected_digest: Option<String>,
    },
    #[serde(rename = "graph.abandon")]
    GraphAbandon {
        command_id: String,
        session_id: String,
        worker_generation: u64,
        why: String,
    },
    #[serde(rename = "graph.run_set.open")]
    GraphRunSetOpen {
        command_id: String,
        session_id: String,
        worker_generation: u64,
        plan_item_id: String,
        plan_event_seq: u64,
    },
    #[serde(rename = "loom.install.status")]
    LoomInstallStatus {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        job_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        agent_type_id: Option<String>,
    },
    #[serde(rename = "loom.install.retry")]
    LoomInstallRetry { job_id: String },
    #[serde(rename = "loom.install.watch")]
    LoomInstallWatch { job_id: String, after_cursor: u64 },
    #[serde(rename = "session.observe")]
    SessionObserve {
        session_id: String,
        #[serde(default)]
        last_event_limit: u32,
        #[serde(default, skip_serializing_if = "is_false")]
        metadata_only: bool,
    },
    #[serde(rename = "session.observe_batch")]
    SessionObserveBatch {
        session_ids: Vec<String>,
        #[serde(default)]
        last_event_limit: u32,
        #[serde(default, skip_serializing_if = "is_false")]
        metadata_only: bool,
    },
    #[serde(rename = "checkpoint.list")]
    CheckpointList {
        session_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        branch_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cursor: Option<CheckpointCursorWire>,
        limit: u16,
    },
    #[serde(rename = "checkpoint.undo")]
    CheckpointUndo {
        command_id: String,
        session_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        branch_id: Option<String>,
        worker_generation: u64,
        target: String,
    },
    #[serde(rename = "checkpoint.redo")]
    CheckpointRedo {
        command_id: String,
        session_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        branch_id: Option<String>,
        worker_generation: u64,
        target: String,
    },
    #[serde(rename = "checkpoint.rollback_turn")]
    CheckpointRollbackTurn {
        command_id: String,
        session_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        branch_id: Option<String>,
        worker_generation: u64,
        run_id: String,
    },
    #[serde(rename = "session.fleet")]
    SessionFleet { session_id: String },
    #[serde(rename = "session.attach")]
    SessionAttach {
        session_id: String,
        after_seq: u64,
        mode: AttachMode,
        #[serde(default, skip_serializing_if = "is_false")]
        sealed_replay: bool,
    },
    #[serde(rename = "session.detach")]
    SessionDetach { attachment_id: String },
    #[serde(rename = "session.rename")]
    SessionRename {
        command_id: String,
        session_id: String,
        worker_generation: u64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
    },
    #[serde(rename = "session.compact")]
    SessionCompact {
        command_id: String,
        session_id: String,
        worker_generation: u64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        branch_id: Option<String>,
    },
    #[serde(rename = "session.fork")]
    SessionFork {
        command_id: String,
        session_id: String,
        worker_generation: u64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        source_branch_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fork_node_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fork_seq: Option<u64>,
    },
    #[serde(rename = "run.retry")]
    RunRetry {
        command_id: String,
        session_id: String,
        worker_generation: u64,
    },
    #[serde(rename = "session.seen")]
    SessionSeen {
        command_id: String,
        session_id: String,
        worker_generation: u64,
    },
    #[serde(rename = "session.select_model")]
    SessionSelectModel {
        command_id: String,
        session_id: String,
        worker_generation: u64,
        model: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        provider: Option<String>,
        #[serde(default, skip_serializing_if = "is_false")]
        confirm_new_epoch: bool,
    },
    #[serde(rename = "session.select_effort")]
    SessionSelectEffort {
        command_id: String,
        session_id: String,
        worker_generation: u64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        effort: Option<String>,
        #[serde(default, skip_serializing_if = "is_false")]
        confirm_new_epoch: bool,
    },
    #[serde(rename = "session.select_agent_type")]
    SessionSelectAgentType {
        command_id: String,
        session_id: String,
        worker_generation: u64,
        agent_type: Option<String>,
    },
    #[serde(rename = "session.select_fast")]
    SessionSelectFast {
        command_id: String,
        session_id: String,
        worker_generation: u64,
        enabled: bool,
        #[serde(default, skip_serializing_if = "is_false")]
        confirm_new_epoch: bool,
    },
    #[serde(rename = "agent.message")]
    AgentMessage {
        command_id: String,
        session_id: String,
        worker_generation: u64,
        agent: String,
        text: String,
    },
    #[serde(rename = "session.surface_publish")]
    SessionSurfacePublish {
        session_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        input: Option<SurfaceInputPublishWire>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        status: Option<SurfaceStatusPublishWire>,
    },
    #[serde(rename = "session.surface_watch")]
    SessionSurfaceWatch { session_id: String },
    #[serde(rename = "turn.submit_from_cli")]
    TurnSubmitFromCli {
        command_id: String,
        session_id: String,
        worker_generation: u64,
        text: String,
        attachments: Vec<Value>,
        mode: DeliveryMode,
    },
    #[serde(rename = "queue.list")]
    QueueList { session_id: String },
    #[serde(rename = "queue.remove")]
    QueueRemove {
        session_id: String,
        id: String,
        revision: u64,
    },
    #[serde(rename = "queue.promote_steer")]
    QueuePromoteSteer {
        session_id: String,
        id: String,
        revision: u64,
    },
    #[serde(rename = "account.list")]
    AccountList {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        provider: Option<String>,
    },
    /// Wire authority: `crates/haider-rpc/src/frame.rs:2281-2286`.
    #[serde(rename = "account.list_watch")]
    AccountListWatch {},
    #[serde(rename = "vault.stage")]
    VaultStage {
        stage_id: String,
        purpose: StagePurpose,
        secret: SecretWire,
    },
    #[serde(rename = "account.login_api")]
    AccountLoginApi {
        command_id: String,
        provider: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        alias: Option<String>,
        vault_reference: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        validation_model: Option<String>,
    },
    #[serde(rename = "account.oauth_start")]
    AccountOauthStart {
        provider: String,
        desired_alias: String,
        attempt_id: String,
    },
    #[serde(rename = "account.oauth_status")]
    AccountOauthStatus { flow_id: String, attempt_id: String },
    #[serde(rename = "account.oauth_cancel")]
    AccountOauthCancel { flow_id: String, attempt_id: String },
    #[serde(rename = "account.add")]
    AccountAdd {
        command_id: String,
        provider: String,
        alias: String,
        auth_method: AccountAddMethod,
        flow_id: String,
        attempt_id: String,
        oauth_reference: String,
    },
    #[serde(rename = "account.oauth_import")]
    AccountOauthImport { command_id: String, source: String },
    #[serde(rename = "account.oauth_import_sources")]
    AccountOauthImportSources,
    #[serde(rename = "account.device_candidates")]
    AccountDeviceCandidates {},
    #[serde(rename = "account.import_device")]
    AccountImportDevice {
        command_id: String,
        candidate: String,
    },
    #[serde(rename = "account.set_active")]
    AccountSetActive {
        command_id: String,
        alias: String,
        #[serde(default, skip_serializing_if = "is_false")]
        confirm_new_epoch: bool,
    },
    /// Cooperative cancellation of a running turn. The daemon journals the
    /// intent BEFORE waking the worker, so the turn is recorded as cancelled
    /// rather than appearing as a truncated answer.
    #[serde(rename = "turn.cancel")]
    TurnCancel {
        command_id: String,
        session_id: String,
        worker_generation: u64,
        run_id: String,
    },
    #[serde(rename = "account.set_label")]
    AccountSetLabel {
        alias: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        label: Option<String>,
    },
    #[serde(rename = "account.remove")]
    AccountRemove {
        command_id: String,
        alias: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        expected_revision: Option<u64>,
    },
    #[serde(rename = "account.set_default_model")]
    AccountSetDefaultModel {
        command_id: String,
        provider: String,
        model: String,
        expected_revision: u64,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "method")]
enum ResponseBody {
    #[serde(rename = "command.list")]
    CommandList {
        #[serde(default)]
        items: Vec<CommandCatalogItemWire>,
    },
    #[serde(rename = "command.invoke")]
    CommandInvoke { outcome: CommandInvokeOutcomeWire },
    #[serde(rename = "artifact.put")]
    ArtifactPut { artifact: String, bytes: u64 },
    #[serde(rename = "session.create")]
    SessionCreate {
        session_id: String,
        created_seq: u64,
        worker_generation: u64,
        metadata: Value,
    },
    #[serde(rename = "session.list")]
    SessionList {
        #[serde(default)]
        sessions: Vec<Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        next_cursor: Option<String>,
    },
    #[serde(rename = "session.list_watch")]
    SessionListWatch { accepted: bool },
    #[serde(rename = "session.read")]
    SessionRead { result: SessionReadResult },
    #[serde(rename = "provider.list")]
    ProviderList {
        #[serde(default)]
        providers: Vec<Value>,
        revision: u64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        availability: Option<SnapshotAvailabilityWire>,
    },
    #[serde(rename = "usage.report")]
    UsageReport {
        report: Value,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        availability: Option<SnapshotAvailabilityWire>,
    },
    #[serde(rename = "usage.history_day")]
    UsageHistoryDay {
        date: String,
        device_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        day: Option<UsageHistoryDayV1>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        availability: Option<SnapshotAvailabilityWire>,
    },
    #[serde(rename = "usage.history_range")]
    UsageHistoryRange {
        through_date: String,
        device_id: String,
        days: Vec<UsageHistoryRangeDayV1>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        availability: Option<SnapshotAvailabilityWire>,
    },
    #[serde(rename = "loom.list")]
    LoomList {
        #[serde(default)]
        agent_types: Vec<LoomAgentType>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        workflows: Vec<Value>,
        #[serde(default)]
        cli_present: BTreeMap<String, bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        workflow_catalog: Option<Vec<WorkflowCatalogEntryV1>>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        archived_entries: Option<Vec<Value>>,
    },
    #[serde(rename = "loom.registered")]
    LoomRegistered {
        registration: LoomRegistrationWire,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        install_job_id: Option<String>,
    },
    #[serde(rename = "loom.author.draft")]
    LoomAuthorDraft { draft: Value },
    #[serde(rename = "loom.author.revise")]
    LoomAuthorRevise { draft: Value },
    #[serde(rename = "loom.author.confirm")]
    LoomAuthorConfirm {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        confirmed: Option<Value>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        errors: Vec<LoomAuthorValidationError>,
    },
    #[serde(rename = "loom.install.cancel")]
    LoomInstallCancel {
        receipt: TypedAgentInstallCancelReceipt,
    },
    #[serde(rename = "loom.archive")]
    LoomArchive { receipt: LoomArchiveReceipt },
    #[serde(rename = "loom.unarchive")]
    LoomUnarchive { receipt: LoomArchiveReceipt },
    #[serde(rename = "loom.validate")]
    LoomValidate {
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        errors: Vec<LoomAuthorValidationError>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        canonical_digest: Option<String>,
    },
    #[serde(rename = "loom.watch")]
    LoomWatch {
        watch_id: String,
        requested_after_cursor: u64,
        baseline: Value,
    },
    #[serde(rename = "workflow.instance")]
    WorkflowInstance {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        instance: Option<WorkflowInstanceV1>,
    },
    #[serde(rename = "workflow.graph.state")]
    WorkflowGraphState {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        state: Option<WorkflowGraphStateV1>,
    },
    #[serde(rename = "workflow.graph.watch")]
    WorkflowGraphWatch { page: WorkflowGraphWatchPageV1 },
    #[serde(rename = "session.descendants.attach")]
    SessionDescendantsAttach {
        attachment_id: String,
        baseline: SessionDescendantBaseline,
    },
    #[serde(rename = "monitor.list")]
    MonitorList { receipt: MonitorListReceiptV1 },
    #[serde(rename = "monitor.register")]
    MonitorRegister { receipt: MonitorRegisterReceiptV1 },
    #[serde(rename = "monitor.remove")]
    MonitorRemove { receipt: MonitorRemoveReceiptV1 },
    #[serde(rename = "monitor.watch")]
    MonitorWatch { receipt: MonitorWatchReceiptV1 },
    #[serde(rename = "graph.status")]
    GraphStatus {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        status: Option<GraphStatus>,
    },
    #[serde(rename = "graph.inspect")]
    GraphInspect {
        snapshot: Value,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        next_cursor: Option<String>,
    },
    #[serde(rename = "graph.pin")]
    GraphPin {
        session_id: String,
        graph_id: String,
        template: String,
        digest: String,
        pinned_seq: u64,
        opened_seq: u64,
        worker_generation: u64,
    },
    #[serde(rename = "graph.switch")]
    GraphSwitch {
        session_id: String,
        old_graph_id: String,
        new_graph_id: String,
        template: String,
        digest: String,
        superseded_seq: u64,
        pinned_seq: u64,
        opened_seq: u64,
        worker_generation: u64,
    },
    #[serde(rename = "graph.abandon")]
    GraphAbandon {
        session_id: String,
        graph_id: String,
        abandoned_seq: u64,
        worker_generation: u64,
    },
    #[serde(rename = "graph.run_set.open")]
    GraphRunSetOpen {
        session_id: String,
        run_set_id: String,
        root_graph_id: String,
        plan_item_id: String,
        plan_event_seq: u64,
        template: String,
        digest: String,
        run_set_opened_seq: u64,
        through_seq: u64,
        #[serde(default = "empty_json_array")]
        children: Value,
        worker_generation: u64,
    },
    #[serde(rename = "loom.install.status")]
    LoomInstallStatus {
        #[serde(default)]
        jobs: Vec<TypedAgentInstallJob>,
        #[serde(default)]
        items: Vec<TypedAgentInstallItem>,
    },
    #[serde(rename = "loom.install.retry")]
    LoomInstallRetry {
        receipt: TypedAgentInstallRetryReceipt,
    },
    #[serde(rename = "loom.install.watch")]
    LoomInstallWatch {
        receipt: TypedAgentInstallWatchReceipt,
    },
    #[serde(rename = "session.observe")]
    SessionObserve { digest: Value },
    #[serde(rename = "session.observe_batch")]
    SessionObserveBatch { digests: Vec<Value> },
    #[serde(rename = "checkpoint.list")]
    CheckpointList { page: CheckpointListPageWire },
    #[serde(rename = "checkpoint.undo")]
    CheckpointUndo {
        receipt: CheckpointMutationReceiptWire,
    },
    #[serde(rename = "checkpoint.redo")]
    CheckpointRedo {
        receipt: CheckpointMutationReceiptWire,
    },
    #[serde(rename = "checkpoint.rollback_turn")]
    CheckpointRollbackTurn {
        receipt: CheckpointMutationReceiptWire,
    },
    #[serde(rename = "session.fleet")]
    SessionFleet { snapshot: SessionFleetSnapshot },
    #[serde(rename = "session.attach")]
    SessionAttach {
        attachment_id: String,
        attach_state: AttachStateWire,
    },
    #[serde(rename = "session.detach")]
    SessionDetach { attachment_id: String },
    #[serde(rename = "session.rename")]
    SessionRename {
        session_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        renamed_seq: u64,
        worker_generation: u64,
    },
    #[serde(rename = "session.compact")]
    SessionCompact {
        session_id: String,
        run_id: String,
        accepted_seq: u64,
        worker_generation: u64,
    },
    #[serde(rename = "session.compact.on_branch")]
    SessionCompactOnBranch {
        session_id: String,
        run_id: String,
        accepted_seq: u64,
        worker_generation: u64,
        branch_id: String,
    },
    #[serde(rename = "session.fork")]
    SessionFork {
        session_id: String,
        source_session_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        source_branch_id: Option<String>,
        fork_node_id: String,
        fork_seq: u64,
        created_seq: u64,
        worker_generation: u64,
        metadata: Value,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        forked_from: Option<Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        draft: Option<Value>,
    },
    #[serde(rename = "run.retry")]
    RunRetry {
        session_id: String,
        run_id: String,
        failed_run_id: String,
        user_seq: u64,
        accepted_seq: u64,
        worker_generation: u64,
    },
    #[serde(rename = "session.seen")]
    SessionSeen {
        session_id: String,
        seen_at_ms: u64,
        seen_seq: u64,
        worker_generation: u64,
    },
    #[serde(rename = "session.select_model")]
    SessionSelectModel {
        session_id: String,
        provider: String,
        model: String,
        selected_seq: u64,
        worker_generation: u64,
    },
    #[serde(rename = "session.select_effort")]
    SessionSelectEffort {
        session_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        effort: Option<String>,
        selected_seq: u64,
        worker_generation: u64,
    },
    #[serde(rename = "session.select_agent_type")]
    SessionSelectAgentType {
        session_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        agent_type: Option<String>,
        selected_seq: u64,
        worker_generation: u64,
    },
    #[serde(rename = "session.select_fast")]
    SessionSelectFast {
        session_id: String,
        enabled: bool,
        selected_seq: u64,
        worker_generation: u64,
    },
    #[serde(rename = "agent.message")]
    AgentMessage { receipt: AgentMessageReceipt },
    #[serde(rename = "session.surface_publish")]
    SessionSurfacePublished {
        session_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        accepted_input_revision: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        accepted_status_revision: Option<u64>,
    },
    #[serde(rename = "session.surface_watch")]
    SessionSurfaceWatching {
        session_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        input: Option<SurfaceInputWire>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        status: Option<SurfaceStatusWire>,
    },
    #[serde(rename = "turn.submit")]
    TurnSubmit {
        session_id: String,
        run_id: String,
        accepted_seq: u64,
        worker_generation: u64,
        disposition: SubmitDisposition,
    },
    #[serde(rename = "queue.list")]
    QueueList {
        session_id: String,
        revision: u64,
        #[serde(default)]
        rows: Vec<QueueRowWire>,
    },
    #[serde(rename = "queue.remove")]
    QueueRemove {
        session_id: String,
        id: String,
        revision: u64,
    },
    #[serde(rename = "queue.promote_steer")]
    QueuePromoteSteer {
        session_id: String,
        id: String,
        revision: u64,
    },
    #[serde(rename = "menu.answer")]
    MenuAnswer { resolution_seq: u64 },
    #[serde(rename = "computer.permission_open_settings")]
    ComputerPermissionOpenSettings { permission: String },
    #[serde(rename = "account.list")]
    AccountList {
        #[serde(default)]
        descriptors: Vec<Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        revision: Option<u64>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        provider_active: Vec<Value>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        provider_defaults: Vec<Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        availability: Option<SnapshotAvailabilityWire>,
    },
    /// Wire authority: `crates/haider-rpc/src/frame.rs:2877-2878`.
    /// Kept raw until the correlated response is handled so malformed
    /// readiness cannot deserialize into a guessed success.
    #[serde(rename = "account.list_watch")]
    AccountListWatch {
        #[serde(default)]
        accepted: Value,
    },
    #[serde(rename = "vault.stage")]
    VaultStage {
        stage_id: String,
        vault_reference: String,
        expires_at_ms: u64,
    },
    #[serde(rename = "account.login_api")]
    AccountLoginApi { descriptor: Value },
    #[serde(rename = "account.oauth_start")]
    AccountOauthStart {
        availability: Value,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        flow_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        authorization_url: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        user_code: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        provider_origin: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        loopback_port: Option<u16>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        expires_at_ms: Option<u64>,
    },
    #[serde(rename = "account.oauth_status")]
    AccountOauthStatus { flow_id: String, status: Value },
    #[serde(rename = "account.oauth_cancel")]
    AccountOauthCancel { flow_id: String, status: Value },
    #[serde(rename = "account.add")]
    AccountAdd { descriptor: Value },
    #[serde(rename = "account.oauth_import")]
    AccountOauthImport { descriptor: Value, revision: u64 },
    #[serde(rename = "account.oauth_import_sources")]
    AccountOauthImportSources { sources: Vec<Value> },
    #[serde(rename = "account.device_candidates")]
    AccountDeviceCandidates {
        discovery_disabled: bool,
        #[serde(default)]
        candidates: Vec<Value>,
    },
    #[serde(rename = "account.import_device")]
    AccountImportDevice { descriptor: Value, revision: u64 },
    #[serde(rename = "turn.cancel")]
    TurnCancel {
        session_id: String,
        run_id: String,
        /// accepted | already_terminal, and the daemon marks it non-exhaustive
        /// — never match this exhaustively.
        status: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        terminal_seq: Option<u64>,
    },
    #[serde(rename = "account.set_label")]
    AccountSetLabel { descriptor: Value, revision: u64 },
    #[serde(rename = "account.set_active")]
    AccountSetActive {
        descriptor: Value,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        prior_alias: Option<String>,
        revision: u64,
    },
    #[serde(rename = "account.remove")]
    AccountRemove {
        removed_alias: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        replacement_active_alias: Option<String>,
        revision: u64,
    },
    #[serde(rename = "account.set_default_model")]
    AccountSetDefaultModel {
        provider_summary: Value,
        revision: u64,
    },
    #[serde(rename = "error")]
    Error {
        code: String,
        message: String,
        retryable: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        data: Option<Value>,
    },
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct ProtocolError {
    code: String,
    message: String,
    fatal: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum WireFrame {
    Hello(Hello),
    Welcome(Welcome),
    Request {
        request_id: String,
        body: RequestBody,
    },
    Response {
        request_id: String,
        body: ResponseBody,
    },
    SessionRosterDelta {
        #[serde(default)]
        summaries: Vec<Value>,
    },
    /// Wire authority: `crates/haider-rpc/src/frame.rs:3284-3287`.
    /// The signal is revision-only. Raw validation lets one malformed signal
    /// be logged and dropped without poisoning the rest of the stream.
    AccountsChanged {
        #[serde(default)]
        revision: Value,
    },
    SessionSurfaceDelta {
        session_id: String,
        #[serde(default)]
        input: Option<SurfaceInputWire>,
        #[serde(default)]
        status: Option<SurfaceStatusWire>,
    },
    Event {
        attachment_id: String,
        session_id: String,
        envelope: RawEnvelopeWire,
    },
    AttachCaughtUp {
        attachment_id: String,
        high_water_seq: u64,
    },
    Lagged {
        attachment_id: String,
        last_queued_seq: u64,
    },
    HaiderCodePlanStatus {
        provider: String,
        account_alias: String,
        outcome: Value,
    },
    ResidentSessionBinding {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
        worker_generation: u64,
    },
    MonitorDelivery {
        watch_id: String,
        report: MonitorDeliveryReportV1,
    },
    MonitorDeliveryCaughtUp {
        watch_id: String,
        session_id: String,
        high_water_cursor: u64,
    },
    LoomRegistryDelta {
        watch_id: String,
        /// The complete tagged registry event remains daemon-owned JSON.
        delta: Value,
    },
    LoomRegistryCaughtUp {
        watch_id: String,
        high_water_cursor: u64,
    },
    /// Raw event records preserve future event/change/state vocabulary.
    SessionDescendantStream {
        attachment_id: String,
        event: Value,
    },
    /// Terminal repair identifies children but deliberately carries no
    /// daemon or client sequence coordinate.
    SessionDescendantRepairRequired {
        attachment_id: String,
        children: Vec<DescendantIdentity>,
    },
    MenuAnswer {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        request_id: Option<String>,
        command_id: String,
        session_id: String,
        menu_id: String,
        request_seq: u64,
        worker_generation: u64,
        option_key: String,
        option_index: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        input: Option<MenuInputWire>,
    },
    Ping {
        nonce: u64,
    },
    Pong {
        nonce: u64,
    },
    ProtocolError(ProtocolError),
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum MenuInputWire {
    Text { text: String },
    SecretVaultReference { vault_reference: String },
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum AttachMode {
    Control,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum DeliveryMode {
    Queue,
    Steer,
    Subturn,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SubmitDisposition {
    Started,
    Queued,
    SteerPending,
    SubturnPending,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct AttachStateWire {
    session_id: String,
    requested_after_seq: u64,
    replay_through_seq: u64,
    worker_generation: u64,
    authority_epoch: u64,
}

/// Only the raw-envelope fields needed for ordered queue forwarding are
/// decoded. Additive envelope fields remain tolerated by serde.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct RawEnvelopeWire {
    seq: u64,
    session_id: String,
    payload: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type")]
enum QueueEventPayloadWire {
    #[serde(rename = "queue_changed")]
    QueueChanged {
        revision: u64,
        change: QueueChangeWire,
    },
    #[serde(other)]
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum QueueChangeWire {
    Enqueued {
        row: QueueRowWire,
    },
    Removed {
        id: String,
    },
    PromotedSteer {
        id: String,
    },
    Consumed {
        id: String,
    },
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
struct QueueEventEnvelopePayload {
    seq: u64,
    payload: QueueEventPayloadWire,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
struct SessionQueueChangedPayload {
    session_id: String,
    envelope: QueueEventEnvelopePayload,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct VersionedFrame {
    #[serde(rename = "v")]
    version: u32,
    #[serde(flatten)]
    frame: WireFrame,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WireEncoding {
    Json,
    Msgpack,
}

impl WireEncoding {
    fn from_welcome(welcome: &Welcome) -> std::io::Result<Self> {
        match welcome.encoding.as_deref().unwrap_or("json") {
            "json" => Ok(Self::Json),
            "msgpack" => Ok(Self::Msgpack),
            encoding => Err(invalid_data(format!(
                "daemon selected unsupported Haider RPC encoding {encoding}"
            ))),
        }
    }
}

fn versioned(frame: WireFrame) -> VersionedFrame {
    VersionedFrame {
        version: WIRE_PROTOCOL_VERSION,
        frame,
    }
}

fn encode_framed(frame: &WireFrame, frame_limit: usize) -> std::io::Result<Vec<u8>> {
    encode_framed_with_encoding(frame, frame_limit, WireEncoding::Json)
}

fn encode_framed_with_encoding(
    frame: &WireFrame,
    frame_limit: usize,
    encoding: WireEncoding,
) -> std::io::Result<Vec<u8>> {
    let mut body = match encoding {
        WireEncoding::Json => {
            serde_json::to_vec(&versioned(frame.clone())).map_err(invalid_data)?
        }
        // The daemon's wire_msgpack_v1 uses named struct maps. Positional
        // tuples would make additive fields a wire break, unlike JSON.
        WireEncoding::Msgpack => {
            rmp_serde::to_vec_named(&versioned(frame.clone())).map_err(invalid_data)?
        }
    };
    if body.is_empty() || body.len() > frame_limit || body.len() > u32::MAX as usize {
        body.zeroize();
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Haider RPC frame exceeds the negotiated limit",
        ));
    }
    let mut framed = Vec::with_capacity(4 + body.len());
    framed.extend_from_slice(&(body.len() as u32).to_be_bytes());
    framed.extend_from_slice(&body);
    body.zeroize();
    Ok(framed)
}

fn decode_body(body: &[u8], frame_limit: usize) -> std::io::Result<WireFrame> {
    decode_body_with_encoding(body, frame_limit, WireEncoding::Json)
}

fn decode_body_with_encoding(
    body: &[u8],
    frame_limit: usize,
    encoding: WireEncoding,
) -> std::io::Result<WireFrame> {
    if body.is_empty() || body.len() > frame_limit {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "invalid Haider RPC frame length",
        ));
    }
    let decoded: VersionedFrame = match encoding {
        WireEncoding::Json => serde_json::from_slice(body).map_err(invalid_data)?,
        WireEncoding::Msgpack => rmp_serde::from_slice(body).map_err(invalid_data)?,
    };
    if decoded.version != WIRE_PROTOCOL_VERSION {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!(
                "unsupported Haider wire version {}; expected {}",
                decoded.version, WIRE_PROTOCOL_VERSION
            ),
        ));
    }
    Ok(decoded.frame)
}

/// Cancellation-safe UDS frame extraction. Reads append bytes here before
/// decoding, so a competing `select!` branch can never discard a prefix or a
/// partially read body.
#[derive(Debug, Default)]
struct StreamingFrameDecoder {
    buffered: Vec<u8>,
}

impl StreamingFrameDecoder {
    fn push(&mut self, bytes: &[u8]) {
        self.buffered.extend_from_slice(bytes);
    }

    fn next(
        &mut self,
        frame_limit: usize,
        encoding: WireEncoding,
    ) -> std::io::Result<Option<WireFrame>> {
        if self.buffered.len() < 4 {
            return Ok(None);
        }
        let body_len =
            u32::from_be_bytes(self.buffered[..4].try_into().expect("prefix length")) as usize;
        if body_len == 0 || body_len > frame_limit {
            return Err(invalid_data("invalid Haider UDS length prefix"));
        }
        let frame_len = 4usize.saturating_add(body_len);
        if self.buffered.len() < frame_len {
            return Ok(None);
        }
        let body = self.buffered[4..frame_len].to_vec();
        self.buffered.drain(..frame_len);
        decode_body_with_encoding(&body, frame_limit, encoding).map(Some)
    }
}

fn invalid_data(error: impl std::fmt::Display) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidData, error.to_string())
}

fn hello_frame() -> WireFrame {
    WireFrame::Hello(Hello {
        protocol_min: WIRE_PROTOCOL_VERSION,
        protocol_max: WIRE_PROTOCOL_VERSION,
        client_name: "rust-diffforge-ade".to_owned(),
        client_version: env!("CARGO_PKG_VERSION").to_owned(),
        client_instance_id: uuid::Uuid::new_v4().to_string(),
        client_kind: ClientKind::Gui,
        capabilities_requested: BTreeSet::from([Capability::View, Capability::Control]),
        max_receive_frame: DEFAULT_FRAME_LIMIT as u32,
        // The pre-negotiation Hello itself remains JSON. An older daemon that
        // ignores this additive field keeps its current JSON stream.
        encodings: vec!["msgpack".to_string()],
    })
}

#[derive(Debug, Clone, Default)]
struct RevisionGate {
    last_input_revision: Option<u64>,
    last_status_revision: Option<u64>,
    input_owner: Option<String>,
    status_owner: Option<String>,
    input: Option<SurfaceInput>,
    status: Option<SurfaceStatus>,
    initialized: bool,
}

impl RevisionGate {
    /// Coalesces a complete current snapshot. Equal/lower revisions from the
    /// same daemon-assigned owner are stale; a new owner starts a fresh
    /// revision domain. A `None` clears a present field and its owner fence.
    /// The first watch acknowledgement is emitted even when both fields are
    /// absent so an attaching UI gets an explicit empty baseline.
    fn accept(
        &mut self,
        input: Option<SurfaceInputWire>,
        status: Option<SurfaceStatusWire>,
    ) -> Option<(Option<SurfaceInput>, Option<SurfaceStatus>)> {
        let mut changed = !self.initialized;
        self.initialized = true;

        match input {
            Some(input)
                if self.input_owner.as_deref() != Some(input.owner.as_str())
                    || self
                        .last_input_revision
                        .is_none_or(|revision| input.revision > revision) =>
            {
                self.last_input_revision = Some(input.revision);
                self.input_owner = Some(input.owner.clone());
                self.input = Some(SurfaceInput {
                    text: input.text,
                    attachments: input
                        .attachments
                        .into_iter()
                        .map(|attachment| SurfaceAttachment {
                            name: attachment.artifact.clone(),
                            artifact: attachment.artifact,
                            mime: attachment.mime,
                            size: attachment.bytes,
                        })
                        .collect(),
                    revision: input.revision,
                    owner: input.owner,
                });
                changed = true;
            }
            Some(_) => {}
            None if self.input.is_some() => {
                self.input = None;
                self.input_owner = None;
                self.last_input_revision = None;
                changed = true;
            }
            None => {}
        }

        match status {
            Some(status)
                if self.status_owner.as_deref() != Some(status.owner.as_str())
                    || self
                        .last_status_revision
                        .is_none_or(|revision| status.revision > revision) =>
            {
                self.last_status_revision = Some(status.revision);
                self.status_owner = Some(status.owner);
                self.status = Some(SurfaceStatus {
                    line: status.line,
                    state: status.state,
                    detail: status.detail,
                    revision: status.revision,
                });
                changed = true;
            }
            Some(_) => {}
            None if self.status.is_some() => {
                self.status = None;
                self.status_owner = None;
                self.last_status_revision = None;
                changed = true;
            }
            None => {}
        }

        changed.then(|| (self.input.clone(), self.status.clone()))
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct RosterConnectionIdentity {
    pub(crate) profile_id: String,
    pub(crate) daemon_generation: u64,
    pub(crate) connection_serial: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct CompleteSessionRosterSnapshot {
    pub(crate) connection: RosterConnectionIdentity,
    pub(crate) summaries: Vec<Value>,
}

#[cfg(unix)]
#[derive(Debug, Clone, Default)]
struct ConnectionSnapshot {
    connected: bool,
    roster_watch_active: bool,
    roster_identity: Option<RosterConnectionIdentity>,
    features: BTreeSet<String>,
    capabilities_granted: BTreeSet<Capability>,
    frame_limit: usize,
}

#[cfg(unix)]
impl ConnectionSnapshot {
    fn grants(&self, capability: Capability) -> bool {
        match capability {
            Capability::View => {
                self.capabilities_granted.contains(&Capability::View)
                    || self.capabilities_granted.contains(&Capability::Control)
            }
            Capability::Control => self.capabilities_granted.contains(&Capability::Control),
            Capability::Unknown => false,
        }
    }

    fn can_watch_surfaces(&self) -> bool {
        self.connected
            && self.grants(Capability::View)
            && (self.features.contains(FEATURE_INPUT_MIRROR_V1)
                || self.features.contains(FEATURE_STATUS_SEGMENT_V1))
    }

    fn can_publish_input(&self) -> bool {
        self.connected
            && self.capabilities_granted.contains(&Capability::Control)
            && self.features.contains(FEATURE_INPUT_MIRROR_V1)
    }

    fn can_publish_input_attachments(&self) -> bool {
        self.can_publish_input()
            && self.features.contains(FEATURE_INPUT_MIRROR_ATTACHMENTS_V1)
            && self.features.contains(FEATURE_ARTIFACT_PUT_V1)
    }

    fn can_watch_roster(&self) -> bool {
        self.connected
            && self.grants(Capability::View)
            && self.features.contains(FEATURE_SESSION_LIST_WATCH_V1)
    }

    fn can_watch_queue(&self) -> bool {
        self.connected
            && self.grants(Capability::Control)
            && self.features.contains(FEATURE_QUEUE_CONTROL_V1)
    }
}

#[cfg(unix)]
#[derive(Debug, Clone)]
enum FeatureGate {
    All(BTreeSet<String>),
    Any(BTreeSet<String>),
}

#[cfg(unix)]
impl FeatureGate {
    fn all(features: BTreeSet<String>) -> Self {
        Self::All(features)
    }

    fn any(features: BTreeSet<String>) -> Self {
        Self::Any(features)
    }

    fn is_satisfied_by(&self, advertised: &BTreeSet<String>) -> bool {
        match self {
            Self::All(required) => required.is_subset(advertised),
            Self::Any(required) => required.iter().any(|feature| advertised.contains(feature)),
        }
    }

    fn unavailable_features(&self, advertised: &BTreeSet<String>) -> Vec<String> {
        match self {
            Self::All(required) => required.difference(advertised).cloned().collect(),
            Self::Any(required) => required.iter().cloned().collect(),
        }
    }
}

#[cfg(unix)]
struct Subscription {
    app: AppHandle,
    revision_gate: RevisionGate,
    queue_cursor: u64,
    queue_attachment_id: Option<String>,
    queue_attach_pending: bool,
    queue_watch_waiters: Vec<QueueWatchReply>,
}

#[cfg(unix)]
impl Subscription {
    fn new(app: AppHandle, session_id: &str) -> Self {
        Self {
            app,
            revision_gate: RevisionGate::default(),
            queue_cursor: super::haider_bridge_head_seq(session_id)
                .and_then(|head| u64::try_from(head).ok())
                .unwrap_or(0),
            queue_attachment_id: None,
            queue_attach_pending: false,
            queue_watch_waiters: Vec::new(),
        }
    }
}

/// Counts connection loss or local emission failures that can invalidate a
/// previously returned descendant live view. It is sampled before each
/// attach and is never interpreted as a journal coordinate.
static DESCENDANT_LOST_EVENTS: AtomicU64 = AtomicU64::new(0);

#[cfg(unix)]
struct DescendantForwarders {
    by_attachment: HashMap<String, AppHandle>,
}

#[cfg(unix)]
impl DescendantForwarders {
    fn new() -> Self {
        Self {
            by_attachment: HashMap::new(),
        }
    }

    fn contains(&self, attachment_id: &str) -> bool {
        self.by_attachment.contains_key(attachment_id)
    }

    fn insert(&mut self, attachment_id: String, app: AppHandle) {
        self.by_attachment.insert(attachment_id, app);
    }

    fn remove(&mut self, attachment_id: &str) {
        self.by_attachment.remove(attachment_id);
    }

    fn emit_stream(&self, attachment_id: String, event: Value) {
        let Some(app) = self.by_attachment.get(&attachment_id) else {
            DESCENDANT_LOST_EVENTS.fetch_add(1, Ordering::Relaxed);
            return;
        };
        if app
            .emit_to(
                "main",
                SESSION_DESCENDANT_STREAM_EVENT,
                SessionDescendantStreamPayload {
                    attachment_id,
                    event,
                },
            )
            .is_err()
        {
            DESCENDANT_LOST_EVENTS.fetch_add(1, Ordering::Relaxed);
        }
    }

    fn emit_repair(&mut self, attachment_id: String, children: Vec<DescendantIdentity>) {
        let Some(app) = self.by_attachment.remove(&attachment_id) else {
            DESCENDANT_LOST_EVENTS.fetch_add(1, Ordering::Relaxed);
            return;
        };
        if app
            .emit_to(
                "main",
                SESSION_DESCENDANT_REPAIR_EVENT,
                SessionDescendantRepairPayload {
                    attachment_id,
                    children,
                },
            )
            .is_err()
        {
            DESCENDANT_LOST_EVENTS.fetch_add(1, Ordering::Relaxed);
        }
    }
}

#[cfg(unix)]
impl Drop for DescendantForwarders {
    fn drop(&mut self) {
        if !self.by_attachment.is_empty() {
            // A connection ended while one or more live views still existed.
            // One monotonic gap signal is sufficient; it is not a loss count.
            DESCENDANT_LOST_EVENTS.fetch_add(1, Ordering::Relaxed);
        }
    }
}

#[cfg(unix)]
struct LoomRegistryForwarders {
    by_watch: HashMap<String, AppHandle>,
}

#[cfg(unix)]
impl LoomRegistryForwarders {
    fn new() -> Self {
        Self {
            by_watch: HashMap::new(),
        }
    }

    fn insert(&mut self, watch_id: String, app: AppHandle) {
        self.by_watch.insert(watch_id, app);
    }

    fn emit_delta(&self, watch_id: String, delta: Value) {
        let Some(app) = self.by_watch.get(&watch_id) else {
            return;
        };
        let _ = app.emit_to(
            "main",
            LOOM_REGISTRY_DELTA_EVENT,
            LoomRegistryDeltaEvent { watch_id, delta },
        );
    }

    fn emit_caught_up(&self, watch_id: String, high_water_cursor: u64) {
        let Some(app) = self.by_watch.get(&watch_id) else {
            return;
        };
        let _ = app.emit_to(
            "main",
            LOOM_REGISTRY_CAUGHT_UP_EVENT,
            LoomRegistryCaughtUpEvent {
                watch_id,
                high_water_cursor,
            },
        );
    }
}

#[cfg(unix)]
type RpcReply = oneshot::Sender<Option<Result<ResponseBody, String>>>;

#[cfg(unix)]
type QueueWatchReply = oneshot::Sender<Result<(), QueueCommandError>>;

#[cfg(unix)]
type AccountRosterWatchReply = oneshot::Sender<AccountRosterWatchState>;

#[cfg(unix)]
#[derive(Debug, Clone, Copy)]
enum RpcErrorStyle {
    Detailed,
    Public,
    Code,
    Passthrough,
}

#[cfg(unix)]
type PendingRpcRequest = (RpcReply, RpcErrorStyle);

#[cfg(unix)]
type DescendantAttachReply = oneshot::Sender<Result<SessionDescendantsAttachment, String>>;

#[cfg(unix)]
type DescendantDetachReply = oneshot::Sender<Result<(), String>>;

#[cfg(unix)]
type LoomWatchReply = oneshot::Sender<Result<LoomWatchResult, LoomCommandError>>;

#[cfg(unix)]
struct PendingDescendantAttach {
    app: AppHandle,
    session_id: String,
    lost_events_at_attach: u64,
    reply: DescendantAttachReply,
}

#[cfg(unix)]
struct PendingDescendantDetach {
    attachment_id: String,
    reply: DescendantDetachReply,
}

#[cfg(unix)]
struct PendingLoomWatch {
    app: AppHandle,
    reply: LoomWatchReply,
}

#[cfg(unix)]
enum ActorCommand {
    /// Interrupts a disconnected backoff so the outer loop attempts the
    /// daemon socket again. It is deliberately a no-op while connected.
    ReconnectNow,
    RosterAttach {
        app: AppHandle,
    },
    AccountRosterAttach {
        window: tauri::WebviewWindow,
        reply: AccountRosterWatchReply,
    },
    QueueAttach {
        app: AppHandle,
        session_id: String,
        reply: QueueWatchReply,
    },
    RpcRequest {
        body: RequestBody,
        capability: Capability,
        features: FeatureGate,
        error_style: RpcErrorStyle,
        reply: RpcReply,
    },
    DescendantAttach {
        app: AppHandle,
        session_id: String,
        cursors: Vec<DescendantReplayCursorWire>,
        max_children: u32,
        reply: DescendantAttachReply,
    },
    DescendantDetach {
        attachment_id: String,
        reply: DescendantDetachReply,
    },
    LoomWatch {
        app: AppHandle,
        after_cursor: u64,
        reply: LoomWatchReply,
    },
    MenuAnswer {
        command_id: String,
        session_id: String,
        menu_id: String,
        request_seq: u64,
        worker_generation: u64,
        option_key: String,
        option_index: u32,
        reply: RpcReply,
    },
    Attach {
        app: AppHandle,
        session_id: String,
        reply: oneshot::Sender<SurfaceCommandStatus>,
    },
    Detach {
        session_id: String,
        reply: oneshot::Sender<SurfaceCommandStatus>,
    },
    PublishInput {
        session_id: String,
        text: String,
        attachments: Vec<SurfaceAttachmentWire>,
        revision: u64,
        reply: oneshot::Sender<SurfaceCommandStatus>,
    },
}

#[cfg(unix)]
#[derive(Clone)]
struct ActorHandle {
    commands: mpsc::UnboundedSender<ActorCommand>,
    connection: watch::Sender<ConnectionSnapshot>,
    resident_binding: watch::Sender<ResidentSessionBindingSnapshot>,
    haider_code_plan_status: watch::Sender<HaiderCodePlanStatusSnapshot>,
    account_roster_watch: watch::Sender<AccountRosterWatchState>,
}

#[cfg(unix)]
static ACTOR: OnceLock<ActorHandle> = OnceLock::new();

#[cfg(unix)]
pub(crate) fn rpc_feature_advertised(feature: &str) -> bool {
    ACTOR.get().is_some_and(|handle| {
        let connection = handle.connection.borrow();
        connection.connected && connection.features.contains(feature)
    })
}

#[cfg(not(unix))]
pub(crate) fn rpc_feature_advertised(_feature: &str) -> bool {
    false
}

#[cfg(unix)]
static ROSTER_WATCH_ACTIVE: AtomicBool = AtomicBool::new(false);

#[cfg(unix)]
fn actor_handle() -> &'static ActorHandle {
    ACTOR.get_or_init(|| {
        let (commands, receiver) = mpsc::unbounded_channel();
        let (connection, _) = watch::channel(ConnectionSnapshot::default());
        let (resident_binding, _) = watch::channel(ResidentSessionBindingSnapshot::default());
        let (haider_code_plan_status, _) = watch::channel(HaiderCodePlanStatusSnapshot::default());
        let (account_roster_watch, _) = watch::channel(AccountRosterWatchState::default());
        tauri::async_runtime::spawn(run_actor(
            receiver,
            connection.clone(),
            resident_binding.clone(),
            haider_code_plan_status.clone(),
            account_roster_watch.clone(),
        ));
        ActorHandle {
            commands,
            connection,
            resident_binding,
            haider_code_plan_status,
            account_roster_watch,
        }
    })
}

/// Returns the last daemon-advertised feature set. On the first call it gives
/// the actor a short opportunity to finish its initial handshake.
#[tauri::command(rename_all = "snake_case")]
pub async fn rpc_features() -> Vec<String> {
    #[cfg(unix)]
    {
        let handle = actor_handle();
        let mut connection = handle.connection.subscribe();
        if !connection.borrow().connected {
            let _ = tokio::time::timeout(FEATURE_SNIFF_TIMEOUT, async {
                loop {
                    connection.changed().await.ok()?;
                    if connection.borrow().connected {
                        return Some(());
                    }
                }
            })
            .await;
        }
        return connection.borrow().features.iter().cloned().collect();
    }
    #[cfg(not(unix))]
    Vec::new()
}

/// Returns the latest resident binding without collapsing an explicit
/// unbound frame into the pre-frame unknown state.
#[tauri::command]
pub async fn resident_session_binding_snapshot() -> ResidentSessionBindingSnapshot {
    #[cfg(unix)]
    {
        return actor_handle().resident_binding.borrow().clone();
    }
    #[cfg(not(unix))]
    ResidentSessionBindingSnapshot::legacy()
}

/// Returns the last typed plan frame without treating a missing frame, a
/// disconnected transport, or an absent percentage field as a numeric value.
pub(crate) fn haider_code_plan_status_snapshot() -> HaiderCodePlanStatusSnapshot {
    #[cfg(unix)]
    {
        return actor_handle().haider_code_plan_status.borrow().clone();
    }
    #[cfg(not(unix))]
    HaiderCodePlanStatusSnapshot::unsupported()
}

#[cfg(unix)]
fn account_roster_watch_preflight(
    connection: &ConnectionSnapshot,
) -> Result<(), AccountRosterWatchState> {
    if !connection.connected {
        return Err(AccountRosterWatchState::unavailable(
            "The Haider RPC connection is unavailable for a live account roster watch.",
        ));
    }
    if !connection.features.contains(FEATURE_ACCOUNT_LIST_WATCH_V1) {
        return Err(AccountRosterWatchState::unavailable(format!(
            "unsupported: the daemon does not advertise {FEATURE_ACCOUNT_LIST_WATCH_V1}"
        )));
    }
    // Harness authority: session_hub/rpc.rs:2029-2039 authorizes this watch
    // with View, exactly like account.list. Unlike queue watch, it does not
    // acquire Control; the separate feature bit is the only asymmetry.
    if !connection.grants(Capability::View) {
        return Err(AccountRosterWatchState::unavailable(
            "capability_denied: the current Haider RPC connection cannot watch accounts",
        ));
    }
    Ok(())
}

fn account_watch_state_from_response(
    body: ResponseBody,
) -> Result<AccountRosterWatchState, String> {
    match body {
        ResponseBody::AccountListWatch {
            accepted: Value::Bool(true),
        } => Ok(AccountRosterWatchState::Live),
        ResponseBody::AccountListWatch {
            accepted: Value::Bool(false),
        } => Ok(AccountRosterWatchState::unavailable(
            "The daemon did not accept account.list_watch.",
        )),
        ResponseBody::AccountListWatch { .. } => {
            Err("account.list_watch returned a malformed accepted flag".to_string())
        }
        ResponseBody::Error { message, .. } => {
            // The daemon's reason is public protocol data. Preserve it
            // verbatim instead of collapsing distinct failures into stale.
            Ok(AccountRosterWatchState::unavailable(message))
        }
        _ => Err("account.list_watch response method mismatch".to_string()),
    }
}

fn forward_account_roster_change(
    revision: Value,
    mut emit: impl FnMut(AccountRosterChangedPayload),
) -> Result<(), String> {
    let revision = revision
        .as_u64()
        .ok_or_else(|| "AccountsChanged revision was not an unsigned integer".to_string())?;
    emit(AccountRosterChangedPayload {
        revision: Some(revision),
        watch: AccountRosterWatchState::Live,
    });
    Ok(())
}

/// Starts the connection-scoped account watch for the invoking webview, or
/// returns its current readiness when already live. The point-in-time
/// `account_list` result carries the same state so snapshot presence never
/// silently implies live authority.
#[tauri::command]
pub async fn account_list_watch(window: tauri::WebviewWindow) -> AccountRosterWatchState {
    #[cfg(unix)]
    {
        let handle = actor_handle();
        let (reply, answer) = oneshot::channel();
        if handle
            .commands
            .send(ActorCommand::AccountRosterAttach { window, reply })
            .is_err()
        {
            return AccountRosterWatchState::unavailable(
                "The account roster watch actor is unavailable.",
            );
        }
        return match tokio::time::timeout(COMMAND_REPLY_TIMEOUT, answer).await {
            Ok(Ok(state)) => state,
            Ok(Err(_)) => AccountRosterWatchState::unavailable(
                "The account roster watch actor dropped its readiness confirmation.",
            ),
            Err(_) => AccountRosterWatchState::unavailable(
                "The account roster watch did not confirm readiness in time.",
            ),
        };
    }
    #[cfg(not(unix))]
    {
        let _ = window;
        AccountRosterWatchState::unavailable("account.list_watch is unavailable on this platform.")
    }
}

/// Starts (or refreshes) a local subscription for one provider session.
#[tauri::command(rename_all = "snake_case")]
pub async fn surface_attach(
    app: AppHandle,
    session_id: String,
) -> Result<SurfaceCommandStatus, String> {
    #[cfg(unix)]
    {
        let handle = actor_handle();
        let (reply, answer) = oneshot::channel();
        if handle
            .commands
            .send(ActorCommand::Attach {
                app,
                session_id,
                reply,
            })
            .is_err()
        {
            return Ok(SurfaceCommandStatus::inactive(false));
        }
        return Ok(command_answer(answer, true).await);
    }
    #[cfg(not(unix))]
    {
        let _ = (app, session_id);
        Ok(SurfaceCommandStatus::inactive(false))
    }
}

/// Stops event delivery for a session. Protocol v1 has no unwatch request, so
/// an active detach reconnects the actor and restores only the remaining local
/// subscriptions, shedding the detached daemon-side registration.
#[tauri::command(rename_all = "snake_case")]
pub async fn surface_detach(session_id: String) -> Result<SurfaceCommandStatus, String> {
    #[cfg(unix)]
    {
        let handle = actor_handle();
        let (reply, answer) = oneshot::channel();
        if handle
            .commands
            .send(ActorCommand::Detach { session_id, reply })
            .is_err()
        {
            return Ok(SurfaceCommandStatus::inactive(false));
        }
        return Ok(command_answer(answer, true).await);
    }
    #[cfg(not(unix))]
    {
        let _ = session_id;
        Ok(SurfaceCommandStatus::inactive(true))
    }
}

/// Publishes the complete volatile composer value. Stale client revisions are
/// suppressed locally in addition to the daemon's per-owner revision fence.
#[tauri::command(rename_all = "snake_case")]
pub async fn surface_publish_input(
    session_id: String,
    text: String,
    attachments: Option<Vec<String>>,
    revision: u64,
) -> Result<SurfaceCommandStatus, String> {
    #[cfg(unix)]
    {
        let handle = actor_handle();
        let attachments = attachments.unwrap_or_default();
        let attachments = if attachments.is_empty()
            || !handle.connection.borrow().can_publish_input_attachments()
        {
            Vec::new()
        } else {
            attachment_upload_or_text_only(upload_staged_paste_attachments(attachments).await)
        };
        let (reply, answer) = oneshot::channel();
        if handle
            .commands
            .send(ActorCommand::PublishInput {
                session_id,
                text,
                attachments,
                revision,
                reply,
            })
            .is_err()
        {
            return Ok(SurfaceCommandStatus::inactive(false));
        }
        return Ok(command_answer(answer, false).await);
    }
    #[cfg(not(unix))]
    {
        let _ = (session_id, text, attachments, revision);
        Ok(SurfaceCommandStatus::inactive(false))
    }
}

pub(crate) fn roster_watch_start(app: AppHandle) {
    #[cfg(unix)]
    {
        let _ = actor_handle()
            .commands
            .send(ActorCommand::RosterAttach { app });
    }
    #[cfg(not(unix))]
    let _ = app;
}

/// A full CLI reconcile may be relaxed only after the subscribed roster feed
/// was successfully installed on a live socket.
pub(crate) fn roster_watch_healthy() -> bool {
    #[cfg(unix)]
    {
        return ACTOR.get().is_some_and(|handle| {
            let connection = handle.connection.borrow();
            connection.connected && ROSTER_WATCH_ACTIVE.load(Ordering::Acquire)
        });
    }
    #[cfg(not(unix))]
    false
}

/// Fetches the daemon's rich roster to completion. `None` means there is no
/// live RPC route, so the bridge may use its CLI fallback.
pub(crate) async fn session_roster_snapshot_rpc() -> Option<Result<Vec<Value>, String>> {
    #[cfg(unix)]
    {
        return session_roster_snapshot_for_bootstrap_rpc()
            .await
            .map(|result| result.map(|snapshot| snapshot.summaries));
    }
    #[cfg(not(unix))]
    None
}

/// Fetches one complete roster fenced to the Welcome that began the current
/// socket connection. The bridge uses the returned identity to ensure a
/// roster from an older connection can never lift the bootstrap barrier.
pub(crate) async fn session_roster_snapshot_for_bootstrap_rpc(
) -> Option<Result<CompleteSessionRosterSnapshot, String>> {
    #[cfg(unix)]
    {
        let connection = actor_handle().connection.borrow().clone();
        if !connection.connected {
            return None;
        }
        let Some(identity) = connection.roster_identity else {
            return Some(Err(
                "session.list connection is missing Welcome identity".to_string()
            ));
        };
        let result = session_roster_snapshot_on_connection(identity.clone()).await;
        return Some(result.map(|summaries| CompleteSessionRosterSnapshot {
            connection: identity,
            summaries,
        }));
    }
    #[cfg(not(unix))]
    None
}

#[cfg(unix)]
async fn session_roster_snapshot_on_connection(
    identity: RosterConnectionIdentity,
) -> Result<Vec<Value>, String> {
    let mut cursor = None;
    let mut seen_cursors = BTreeSet::new();
    let mut summaries = Vec::new();
    loop {
        if !roster_connection_is_current(&identity) {
            return Err("session.list connection changed before completion".to_string());
        }
        let response = rpc_request(
            RequestBody::SessionList {
                cursor: cursor.clone(),
                limit: 256,
            },
            Capability::View,
            BTreeSet::new(),
        )
        .await
        .ok_or_else(|| "session.list connection became unavailable".to_string())?;
        if !roster_connection_is_current(&identity) {
            return Err("session.list connection changed before completion".to_string());
        }
        let (sessions, next_cursor) = match response {
            Ok(ResponseBody::SessionList {
                sessions,
                next_cursor,
            }) => (sessions, next_cursor),
            Ok(_) => return Err("session.list response method mismatch".to_string()),
            Err(error) => return Err(error),
        };
        summaries.extend(sessions);
        let Some(next_cursor) = next_cursor else {
            return Ok(summaries);
        };
        if !seen_cursors.insert(next_cursor.clone()) {
            return Err("session.list returned a repeated cursor".to_string());
        }
        cursor = Some(next_cursor);
    }
}

pub(crate) fn roster_connection_is_current(identity: &RosterConnectionIdentity) -> bool {
    #[cfg(unix)]
    {
        return ACTOR.get().is_some_and(|handle| {
            let connection = handle.connection.borrow();
            connection.connected && connection.roster_identity.as_ref() == Some(identity)
        });
    }
    #[cfg(not(unix))]
    {
        let _ = identity;
        false
    }
}

impl QueueCommandError {
    fn unsupported() -> Self {
        Self {
            code: "unsupported".to_string(),
            message: format!("The daemon does not advertise {FEATURE_QUEUE_CONTROL_V1}."),
            retryable: false,
            data: None,
        }
    }

    fn unavailable(message: impl Into<String>) -> Self {
        Self {
            code: "unavailable".to_string(),
            message: message.into(),
            retryable: true,
            data: None,
        }
    }

    fn protocol(message: impl Into<String>) -> Self {
        Self {
            code: "protocol_error".to_string(),
            message: message.into(),
            retryable: false,
            data: None,
        }
    }

    fn from_daemon(code: String, message: String, retryable: bool, data: Option<Value>) -> Self {
        Self {
            code,
            message,
            retryable,
            data,
        }
    }
}

#[cfg(unix)]
fn queue_preflight(connection: &ConnectionSnapshot) -> Result<(), QueueCommandError> {
    if !connection.connected {
        return Err(QueueCommandError::unavailable(
            "The Haider RPC connection is unavailable.",
        ));
    }
    if !connection.features.contains(FEATURE_QUEUE_CONTROL_V1) {
        return Err(QueueCommandError::unsupported());
    }
    if !connection.grants(Capability::View) {
        return Err(QueueCommandError::from_daemon(
            "capability_denied".to_string(),
            "The current Haider RPC connection cannot read queues.".to_string(),
            false,
            None,
        ));
    }
    Ok(())
}

#[cfg(unix)]
fn queue_watch_preflight(connection: &ConnectionSnapshot) -> Result<(), QueueCommandError> {
    if !connection.connected {
        return Err(QueueCommandError::unavailable(
            "The Haider RPC connection is unavailable for a live queue watch.",
        ));
    }
    if !connection.features.contains(FEATURE_QUEUE_CONTROL_V1) {
        return Err(QueueCommandError::unsupported());
    }
    if !connection.grants(Capability::Control) {
        return Err(QueueCommandError::from_daemon(
            "capability_denied".to_string(),
            "The current Haider RPC connection cannot establish the live queue watch required for an authoritative snapshot.".to_string(),
            false,
            None,
        ));
    }
    Ok(())
}

#[cfg(unix)]
async fn queue_preflight_current() -> Result<(), QueueCommandError> {
    let handle = actor_handle();
    let mut connection = handle.connection.subscribe();
    if !connection.borrow().connected {
        let _ = tokio::time::timeout(FEATURE_SNIFF_TIMEOUT, async {
            while connection.changed().await.is_ok() {
                if connection.borrow().connected {
                    break;
                }
            }
        })
        .await;
    }
    let result = queue_preflight(&connection.borrow());
    result
}

#[cfg(unix)]
async fn queue_provider_session_id(session_id: String) -> Result<String, QueueCommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        super::session_provider_session_id_blocking(&session_id)
    })
    .await
    .map_err(|error| {
        QueueCommandError::unavailable(format!("Queue session lookup failed: {error}"))
    })?
    .map_err(|error| QueueCommandError::protocol(format!("Queue session lookup failed: {error}")))
}

#[cfg(unix)]
async fn queue_watch_start(app: AppHandle, session_id: String) -> Result<(), QueueCommandError> {
    let (reply, answer) = oneshot::channel();
    actor_handle()
        .commands
        .send(ActorCommand::QueueAttach {
            app,
            session_id,
            reply,
        })
        .map_err(|_| QueueCommandError::unavailable("The queue watch actor is unavailable."))?;
    match tokio::time::timeout(COMMAND_REPLY_TIMEOUT, answer).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err(QueueCommandError::unavailable(
            "The queue watch actor dropped its readiness confirmation.",
        )),
        Err(_) => Err(QueueCommandError::unavailable(
            "The live queue watch did not confirm readiness in time.",
        )),
    }
}

#[cfg(unix)]
async fn queue_request(
    body: RequestBody,
    capability: Capability,
) -> Result<ResponseBody, QueueCommandError> {
    match rpc_request_with_feature_gate(
        body,
        capability,
        FeatureGate::all(BTreeSet::from([FEATURE_QUEUE_CONTROL_V1.to_string()])),
        RpcErrorStyle::Passthrough,
    )
    .await
    {
        Some(Ok(response)) => Ok(response),
        Some(Err(error)) if error.starts_with("missing_feature:") => {
            Err(QueueCommandError::unsupported())
        }
        Some(Err(error)) if error == "capability_denied" => Err(QueueCommandError::from_daemon(
            error,
            "The current Haider RPC connection lacks the required capability.".to_string(),
            false,
            None,
        )),
        Some(Err(error)) => Err(QueueCommandError::unavailable(error)),
        None => Err(QueueCommandError::unavailable(
            "The queue RPC request did not receive a response.",
        )),
    }
}

fn queue_list_response(body: ResponseBody) -> Result<QueueListResult, QueueCommandError> {
    match body {
        ResponseBody::QueueList {
            session_id,
            revision,
            rows,
        } => Ok(QueueListResult {
            session_id,
            revision,
            rows,
        }),
        response => Err(queue_response_error(
            response,
            "queue.list response method mismatch",
        )),
    }
}

fn queue_list_result(
    response: Result<ResponseBody, QueueCommandError>,
) -> Result<QueueListResult, QueueCommandError> {
    queue_list_response(response?)
}

#[cfg(unix)]
async fn queue_list_with_watch<W, L>(
    watch: W,
    list: L,
) -> Result<QueueListResult, QueueCommandError>
where
    W: Future<Output = Result<(), QueueCommandError>>,
    L: Future<Output = Result<ResponseBody, QueueCommandError>>,
{
    /* Neither response owns authority alone. Awaiting both makes attach-first
    and list-first delivery equivalent while the webview listener buffers
    any deltas that race the snapshot. */
    let (watch_result, list_result) = tokio::join!(watch, list);
    watch_result?;
    queue_list_result(list_result)
}

fn queue_mutation_response(
    body: ResponseBody,
    promote_steer: bool,
) -> Result<QueueMutationResult, QueueCommandError> {
    let mismatch = if promote_steer {
        "queue.promote_steer response method mismatch"
    } else {
        "queue.remove response method mismatch"
    };
    let (session_id, id, revision) = match body {
        ResponseBody::QueueRemove {
            session_id,
            id,
            revision,
        } if !promote_steer => (session_id, id, revision),
        ResponseBody::QueuePromoteSteer {
            session_id,
            id,
            revision,
        } if promote_steer => (session_id, id, revision),
        response => return Err(queue_response_error(response, mismatch)),
    };
    Ok(QueueMutationResult {
        session_id,
        id,
        revision,
    })
}

fn queue_response_error(body: ResponseBody, mismatch: &'static str) -> QueueCommandError {
    match body {
        ResponseBody::Error {
            code,
            message,
            retryable,
            data,
        } => QueueCommandError::from_daemon(code, message, retryable, data),
        _ => QueueCommandError::protocol(mismatch),
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn queue_list(
    app: AppHandle,
    session_id: String,
) -> Result<QueueListResult, QueueCommandError> {
    #[cfg(unix)]
    {
        queue_preflight_current().await?;
        let provider_session_id = queue_provider_session_id(session_id).await?;
        return queue_list_with_watch(
            queue_watch_start(app, provider_session_id.clone()),
            queue_request(
                RequestBody::QueueList {
                    session_id: provider_session_id,
                },
                Capability::View,
            ),
        )
        .await;
    }
    #[cfg(not(unix))]
    {
        let _ = (app, session_id);
        Err(QueueCommandError::unsupported())
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn queue_remove(
    app: AppHandle,
    session_id: String,
    id: String,
    revision: u64,
) -> Result<QueueMutationResult, QueueCommandError> {
    #[cfg(unix)]
    {
        queue_preflight_current().await?;
        let provider_session_id = queue_provider_session_id(session_id).await?;
        queue_watch_start(app, provider_session_id.clone()).await?;
        return queue_mutation_response(
            queue_request(
                RequestBody::QueueRemove {
                    session_id: provider_session_id,
                    id,
                    revision,
                },
                Capability::Control,
            )
            .await?,
            false,
        );
    }
    #[cfg(not(unix))]
    {
        let _ = (app, session_id, id, revision);
        Err(QueueCommandError::unsupported())
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn queue_promote_steer(
    app: AppHandle,
    session_id: String,
    id: String,
    revision: u64,
) -> Result<QueueMutationResult, QueueCommandError> {
    #[cfg(unix)]
    {
        queue_preflight_current().await?;
        let provider_session_id = queue_provider_session_id(session_id).await?;
        queue_watch_start(app, provider_session_id.clone()).await?;
        return queue_mutation_response(
            queue_request(
                RequestBody::QueuePromoteSteer {
                    session_id: provider_session_id,
                    id,
                    revision,
                },
                Capability::Control,
            )
            .await?,
            true,
        );
    }
    #[cfg(not(unix))]
    {
        let _ = (app, session_id, id, revision);
        Err(QueueCommandError::unsupported())
    }
}

#[cfg(unix)]
async fn rpc_request(
    body: RequestBody,
    capability: Capability,
    features: BTreeSet<String>,
) -> Option<Result<ResponseBody, String>> {
    rpc_request_with_feature_gate(
        body,
        capability,
        FeatureGate::all(features),
        RpcErrorStyle::Detailed,
    )
    .await
}

#[cfg(unix)]
async fn rpc_request_with_feature_gate(
    body: RequestBody,
    capability: Capability,
    features: FeatureGate,
    error_style: RpcErrorStyle,
) -> Option<Result<ResponseBody, String>> {
    let (reply, answer) = oneshot::channel();
    actor_handle()
        .commands
        .send(ActorCommand::RpcRequest {
            body,
            capability,
            features,
            error_style,
            reply,
        })
        .ok()?;
    tokio::time::timeout(COMMAND_REPLY_TIMEOUT, answer)
        .await
        .ok()?
        .ok()?
}

#[cfg(unix)]
fn command_feature_gate() -> FeatureGate {
    FeatureGate::all(BTreeSet::from([FEATURE_COMMAND_DOOR_V1.to_string()]))
}

#[cfg(unix)]
fn command_preflight(
    connection: &ConnectionSnapshot,
    capability: Capability,
    failure_code: &str,
) -> Result<(), String> {
    if !connection.connected {
        return Err(HAIDER_COMMAND_NO_CONNECTION.to_string());
    }
    if !connection.features.contains(FEATURE_COMMAND_DOOR_V1) {
        return Err(HAIDER_COMMAND_FEATURE_MISSING.to_string());
    }
    if !connection.grants(capability) {
        return Err(failure_code.to_string());
    }
    Ok(())
}

#[cfg(unix)]
async fn command_request(
    body: RequestBody,
    capability: Capability,
    failure_code: &str,
) -> Result<ResponseBody, String> {
    command_preflight(
        &actor_handle().connection.borrow(),
        capability,
        failure_code,
    )?;
    match rpc_request_with_feature_gate(
        body,
        capability,
        command_feature_gate(),
        RpcErrorStyle::Public,
    )
    .await
    {
        Some(Ok(response)) => Ok(response),
        Some(Err(error)) if error.starts_with("missing_feature:") => {
            Err(HAIDER_COMMAND_FEATURE_MISSING.to_string())
        }
        Some(Err(_)) => Err(failure_code.to_string()),
        None if !actor_handle().connection.borrow().connected => {
            Err(HAIDER_COMMAND_NO_CONNECTION.to_string())
        }
        None => Err(failure_code.to_string()),
    }
}

/// Lists the context-sensitive command catalog. No result is cached: callers
/// must re-list after moving between the launcher and an attached session,
/// where ownership (notably `/model`) can change.
#[tauri::command(rename_all = "snake_case")]
pub async fn command_list(
    query: String,
    in_session: bool,
    slots: Value,
) -> Result<Vec<CommandCatalogItemWire>, String> {
    #[cfg(unix)]
    {
        return match command_request(
            RequestBody::CommandList {
                query,
                in_session,
                slots,
            },
            Capability::View,
            HAIDER_COMMAND_LIST_FAILED,
        )
        .await?
        {
            ResponseBody::CommandList { items } => Ok(items),
            _ => Err(HAIDER_COMMAND_LIST_FAILED.to_string()),
        };
    }
    #[cfg(not(unix))]
    {
        let _ = (query, in_session, slots);
        Err(HAIDER_COMMAND_NO_CONNECTION.to_string())
    }
}

/// Invokes a daemon-owned command. A Parked result is merged into the local
/// session mirror before this returns, then the frontend refreshes and the
/// existing NeedsInputCard/menu.answer path owns rendering and answering.
#[tauri::command(rename_all = "snake_case")]
pub async fn command_invoke(
    app: AppHandle,
    command_id: String,
    command: String,
    session_id: String,
) -> Result<CommandInvokeOutcomeWire, String> {
    #[cfg(unix)]
    {
        let local_session_id = session_id.trim().to_string();
        let provider_session_id = if local_session_id.is_empty() {
            None
        } else {
            let lookup_id = local_session_id.clone();
            Some(
                tauri::async_runtime::spawn_blocking(move || {
                    super::session_provider_session_id_blocking(&lookup_id)
                })
                .await
                .map_err(|_| HAIDER_COMMAND_INVOKE_FAILED.to_string())?
                .map_err(|_| HAIDER_COMMAND_INVOKE_FAILED.to_string())?,
            )
        };
        let command_id = if command_id.trim().is_empty() {
            format!("diffforge-command-{}", uuid::Uuid::new_v4())
        } else {
            command_id
        };
        let outcome = match command_request(
            RequestBody::CommandInvoke {
                command_id,
                command,
                session_id: provider_session_id,
            },
            Capability::Control,
            HAIDER_COMMAND_INVOKE_FAILED,
        )
        .await?
        {
            ResponseBody::CommandInvoke { outcome } => outcome,
            _ => return Err(HAIDER_COMMAND_INVOKE_FAILED.to_string()),
        };

        if let CommandInvokeOutcomeWire::Parked { needs_input } = &outcome {
            if local_session_id.is_empty() {
                return Err(HAIDER_COMMAND_PARK_FAILED.to_string());
            }
            let store_id = local_session_id;
            let card = needs_input.clone();
            tauri::async_runtime::spawn_blocking(move || {
                super::session_store_needs_input_blocking(&store_id, card)
            })
            .await
            .map_err(|_| HAIDER_COMMAND_PARK_FAILED.to_string())?
            .map_err(|_| HAIDER_COMMAND_PARK_FAILED.to_string())?;
            super::sessions_emit_changed(&app);
        }
        Ok(outcome)
    }
    #[cfg(not(unix))]
    {
        let _ = (app, command_id, command, session_id);
        Err(HAIDER_COMMAND_NO_CONNECTION.to_string())
    }
}

/// Reads one bounded inclusive range from the daemon's committed journal.
/// `None` means there is no live ADE connection, which is the caller's signal
/// to use its pipe fallback. A connected daemon rejection remains an error so
/// protocol and authorization failures are never disguised as offline state.
pub(crate) async fn session_read_rpc(
    session_id: String,
    start_seq: u64,
    end_seq: u64,
) -> Option<Result<SessionReadResult, String>> {
    #[cfg(unix)]
    {
        let response = rpc_request(
            RequestBody::SessionRead {
                session_id,
                range: SessionReadRange { start_seq, end_seq },
            },
            Capability::View,
            BTreeSet::new(),
        )
        .await?;
        return Some(match response {
            Ok(ResponseBody::SessionRead { result }) => Ok(result),
            Ok(_) => Err("session.read response method mismatch".to_string()),
            Err(error) => Err(error),
        });
    }
    #[cfg(not(unix))]
    {
        let _ = (session_id, start_seq, end_seq);
        None
    }
}

#[cfg(unix)]
async fn rpc_menu_answer(
    command_id: String,
    session_id: String,
    menu_id: String,
    request_seq: u64,
    worker_generation: u64,
    option_key: String,
    option_index: u32,
) -> Option<Result<ResponseBody, String>> {
    let (reply, answer) = oneshot::channel();
    actor_handle()
        .commands
        .send(ActorCommand::MenuAnswer {
            command_id,
            session_id,
            menu_id,
            request_seq,
            worker_generation,
            option_key,
            option_index,
            reply,
        })
        .ok()?;
    tokio::time::timeout(COMMAND_REPLY_TIMEOUT, answer)
        .await
        .ok()?
        .ok()?
}

#[cfg(unix)]
fn account_feature_gate(features: &[&str]) -> FeatureGate {
    FeatureGate::all(
        features
            .iter()
            .map(|feature| (*feature).to_string())
            .collect(),
    )
}

#[cfg(unix)]
fn account_oauth_feature_gate(provider: &str) -> FeatureGate {
    match provider {
        "openai-oauth" | "anthropic-oauth" => {
            account_feature_gate(&[FEATURE_ACCOUNT_OAUTH_PKCE_V1])
        }
        "kimi-oauth" | "grok-oauth" => account_feature_gate(&[FEATURE_ACCOUNT_OAUTH_DEVICE_V1]),
        // The daemon returns `available: false` for unsupported registrations.
        // An unrecognised provider therefore needs either supported OAuth mode
        // to reach that honest availability response.
        _ => FeatureGate::any(BTreeSet::from([
            FEATURE_ACCOUNT_OAUTH_PKCE_V1.to_string(),
            FEATURE_ACCOUNT_OAUTH_DEVICE_V1.to_string(),
        ])),
    }
}

#[cfg(unix)]
fn account_oauth_flow_feature_gate() -> FeatureGate {
    FeatureGate::any(BTreeSet::from([
        FEATURE_ACCOUNT_OAUTH_PKCE_V1.to_string(),
        FEATURE_ACCOUNT_OAUTH_DEVICE_V1.to_string(),
    ]))
}

#[cfg(unix)]
fn account_command_id(label: &str) -> String {
    format!("diffforge-{label}-{}", uuid::Uuid::new_v4())
}

#[cfg(unix)]
fn account_stage_id() -> String {
    format!("diffforge-vault-stage-{}", uuid::Uuid::new_v4())
}

#[cfg(unix)]
fn account_error(error: String) -> String {
    error
        .starts_with("missing_feature:")
        .then_some(HAIDER_ACCOUNTS_UNAVAILABLE.to_string())
        .unwrap_or(error)
}

#[cfg(unix)]
async fn account_request(
    body: RequestBody,
    capability: Capability,
    features: FeatureGate,
) -> Result<ResponseBody, String> {
    match rpc_request_with_feature_gate(body, capability, features, RpcErrorStyle::Public).await {
        Some(Ok(response)) => Ok(response),
        Some(Err(error)) => Err(account_error(error)),
        None => Err(HAIDER_ACCOUNTS_UNAVAILABLE.to_string()),
    }
}

fn account_list_response(
    body: ResponseBody,
    watch: AccountRosterWatchState,
) -> Result<AccountListResult, String> {
    match body {
        ResponseBody::AccountList {
            descriptors,
            revision,
            provider_active,
            provider_defaults,
            availability,
        } => Ok(AccountListResult {
            descriptors,
            revision,
            provider_active,
            provider_defaults,
            availability,
            watch,
        }),
        _ => Err("account.list response method mismatch".to_string()),
    }
}

fn loom_list_response(body: ResponseBody) -> Result<LoomListResult, String> {
    loom_list_response_for_request(body, false)
}

fn loom_list_response_for_request(
    body: ResponseBody,
    include_archived: bool,
) -> Result<LoomListResult, String> {
    match body {
        ResponseBody::LoomList {
            agent_types,
            workflows,
            cli_present,
            workflow_catalog,
            archived_entries,
        } => Ok(LoomListResult {
            agent_types,
            workflows,
            cli_present,
            workflow_catalog,
            include_archived,
            archived_entries: include_archived.then(|| archived_entries.unwrap_or_default()),
        }),
        _ => Err("loom.list response method mismatch".to_string()),
    }
}

fn loom_registration_response(body: ResponseBody) -> Result<LoomRegistrationReceipt, String> {
    match body {
        ResponseBody::LoomRegistered {
            registration,
            install_job_id,
        } => Ok(LoomRegistrationReceipt {
            id: registration.id,
            rev: registration.rev,
            digest: registration.digest,
            updated: registration.updated,
            install_job_id,
        }),
        _ => Err("loom.register_agent_type response method mismatch".to_string()),
    }
}

fn loom_install_status_response(body: ResponseBody) -> Result<TypedAgentInstallStatus, String> {
    match body {
        ResponseBody::LoomInstallStatus { jobs, items } => {
            Ok(TypedAgentInstallStatus { jobs, items })
        }
        _ => Err("loom.install.status response method mismatch".to_string()),
    }
}

fn loom_install_retry_response(
    body: ResponseBody,
) -> Result<TypedAgentInstallRetryReceipt, String> {
    match body {
        ResponseBody::LoomInstallRetry { receipt } => Ok(receipt),
        _ => Err("loom.install.retry response method mismatch".to_string()),
    }
}

fn loom_install_watch_response(
    body: ResponseBody,
) -> Result<TypedAgentInstallWatchReceipt, String> {
    match body {
        ResponseBody::LoomInstallWatch { receipt } => Ok(receipt),
        _ => Err("loom.install.watch response method mismatch".to_string()),
    }
}

impl LoomCommandError {
    fn unavailable(message: impl Into<String>) -> Self {
        Self {
            code: "unavailable".to_string(),
            message: message.into(),
            retryable: true,
            data: None,
        }
    }

    fn protocol(message: impl Into<String>) -> Self {
        Self {
            code: "protocol_error".to_string(),
            message: message.into(),
            retryable: false,
            data: None,
        }
    }

    fn from_daemon(code: String, message: String, retryable: bool, data: Option<Value>) -> Self {
        let data = data
            .map(|raw| serde_json::from_value(raw.clone()).unwrap_or(LoomErrorData::Unknown(raw)));
        Self {
            code,
            message,
            retryable,
            data,
        }
    }
}

fn loom_response_error(body: ResponseBody, mismatch: &'static str) -> LoomCommandError {
    match body {
        ResponseBody::Error {
            code,
            message,
            retryable,
            data,
        } => LoomCommandError::from_daemon(code, message, retryable, data),
        _ => LoomCommandError::protocol(mismatch),
    }
}

fn loom_cas_registration_response(
    body: ResponseBody,
    mismatch: &'static str,
) -> Result<LoomRegistrationReceipt, LoomCommandError> {
    match body {
        ResponseBody::LoomRegistered {
            registration,
            install_job_id,
        } => Ok(LoomRegistrationReceipt {
            id: registration.id,
            rev: registration.rev,
            digest: registration.digest,
            updated: registration.updated,
            install_job_id,
        }),
        response => Err(loom_response_error(response, mismatch)),
    }
}

fn loom_author_draft_response(
    body: ResponseBody,
) -> Result<LoomAuthorDraftResult, LoomCommandError> {
    match body {
        ResponseBody::LoomAuthorDraft { draft } => Ok(LoomAuthorDraftResult { draft }),
        response => Err(loom_response_error(
            response,
            "loom.author.draft response method mismatch",
        )),
    }
}

fn loom_author_revise_response(
    body: ResponseBody,
) -> Result<LoomAuthorDraftResult, LoomCommandError> {
    match body {
        ResponseBody::LoomAuthorRevise { draft } => Ok(LoomAuthorDraftResult { draft }),
        response => Err(loom_response_error(
            response,
            "loom.author.revise response method mismatch",
        )),
    }
}

fn loom_author_confirm_response(
    body: ResponseBody,
) -> Result<LoomAuthorConfirmResult, LoomCommandError> {
    match body {
        ResponseBody::LoomAuthorConfirm { confirmed, errors } => {
            Ok(LoomAuthorConfirmResult { confirmed, errors })
        }
        response => Err(loom_response_error(
            response,
            "loom.author.confirm response method mismatch",
        )),
    }
}

fn loom_install_cancel_response(
    body: ResponseBody,
) -> Result<TypedAgentInstallCancelReceipt, LoomCommandError> {
    match body {
        ResponseBody::LoomInstallCancel { receipt } => Ok(receipt),
        response => Err(loom_response_error(
            response,
            "loom.install.cancel response method mismatch",
        )),
    }
}

fn loom_archive_response(body: ResponseBody) -> Result<LoomArchiveReceipt, LoomCommandError> {
    match body {
        ResponseBody::LoomArchive { receipt } => Ok(receipt),
        response => Err(loom_response_error(
            response,
            "loom.archive response method mismatch",
        )),
    }
}

fn loom_unarchive_response(body: ResponseBody) -> Result<LoomArchiveReceipt, LoomCommandError> {
    match body {
        ResponseBody::LoomUnarchive { receipt } => Ok(receipt),
        response => Err(loom_response_error(
            response,
            "loom.unarchive response method mismatch",
        )),
    }
}

fn loom_validate_response(body: ResponseBody) -> Result<LoomValidateResult, LoomCommandError> {
    match body {
        ResponseBody::LoomValidate {
            errors,
            canonical_digest,
        } => Ok(LoomValidateResult {
            errors,
            canonical_digest,
        }),
        response => Err(loom_response_error(
            response,
            "loom.validate response method mismatch",
        )),
    }
}

fn loom_watch_response(body: ResponseBody) -> Result<LoomWatchResult, LoomCommandError> {
    match body {
        ResponseBody::LoomWatch {
            watch_id,
            requested_after_cursor,
            baseline,
        } => Ok(LoomWatchResult {
            watch_id,
            requested_after_cursor,
            baseline,
        }),
        response => Err(loom_response_error(
            response,
            "loom.watch response method mismatch",
        )),
    }
}

fn monitor_list_request(session_id: String) -> RequestBody {
    RequestBody::MonitorList { session_id }
}

fn parse_descendant_after_seq(after_seq: &str) -> Result<u64, String> {
    if after_seq.is_empty() || !after_seq.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(
            "session.descendants.attach after_seq must be a decimal u64 string".to_string(),
        );
    }
    after_seq.parse::<u64>().map_err(|_| {
        "session.descendants.attach after_seq must be a decimal u64 string".to_string()
    })
}

fn descendant_replay_cursors_wire(
    cursors: Vec<DescendantReplayCursor>,
) -> Result<Vec<DescendantReplayCursorWire>, String> {
    cursors
        .into_iter()
        .map(|cursor| {
            if cursor.session_id.is_empty() || cursor.agent_id.is_empty() {
                return Err(
                    "session.descendants.attach cursors require session_id and agent_id"
                        .to_string(),
                );
            }
            Ok(DescendantReplayCursorWire {
                session_id: cursor.session_id,
                agent_id: cursor.agent_id,
                after_seq: parse_descendant_after_seq(&cursor.after_seq)?,
            })
        })
        .collect()
}

fn session_descendants_attach_request(
    session_id: String,
    cursors: Vec<DescendantReplayCursorWire>,
    max_children: u32,
) -> RequestBody {
    RequestBody::SessionDescendantsAttach {
        session_id,
        cursors,
        max_children,
    }
}

fn session_descendants_attach_response(
    body: ResponseBody,
    expected_session_id: &str,
    lost_events_at_attach: u64,
) -> Result<SessionDescendantsAttachment, String> {
    match body {
        ResponseBody::SessionDescendantsAttach {
            attachment_id,
            baseline,
        } if baseline.session_id == expected_session_id => Ok(SessionDescendantsAttachment {
            attachment_id,
            baseline,
            lost_events_at_attach,
        }),
        ResponseBody::SessionDescendantsAttach { .. } => {
            Err("session.descendants.attach response baseline session mismatch".to_string())
        }
        ResponseBody::Error { code, .. } => Err(code),
        _ => Err("session.descendants.attach response method mismatch".to_string()),
    }
}

fn session_descendants_detach_response(
    body: ResponseBody,
    expected_attachment_id: &str,
) -> Result<(), String> {
    match body {
        ResponseBody::SessionDetach { attachment_id }
            if attachment_id == expected_attachment_id =>
        {
            Ok(())
        }
        ResponseBody::SessionDetach { .. } => {
            Err("session.detach response attachment mismatch".to_string())
        }
        ResponseBody::Error { code, .. } => Err(code),
        _ => Err("session.detach response method mismatch".to_string()),
    }
}

#[allow(clippy::too_many_arguments)]
fn monitor_register_request(
    command_id: String,
    session_id: String,
    worker_generation: u64,
    source: Value,
    filter: Option<Value>,
    action: Value,
    occurrence: Value,
    lifetime: Value,
) -> RequestBody {
    RequestBody::MonitorRegister {
        command_id,
        session_id,
        worker_generation,
        source,
        filter: filter.filter(|filter| !filter.is_null()),
        action,
        occurrence,
        lifetime,
    }
}

fn monitor_remove_request(
    command_id: String,
    session_id: String,
    worker_generation: u64,
    monitor_id: String,
) -> RequestBody {
    RequestBody::MonitorRemove {
        command_id,
        session_id,
        worker_generation,
        monitor_id,
    }
}

fn monitor_watch_request(session_id: String, after_cursor: u64) -> RequestBody {
    RequestBody::MonitorWatch {
        session_id,
        after_cursor,
    }
}

fn parse_monitor_watch_after_cursor(after_cursor: &str) -> Result<u64, String> {
    if after_cursor.is_empty() || !after_cursor.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err("monitor.watch after_cursor must be a decimal u64 string".to_string());
    }
    after_cursor
        .parse::<u64>()
        .map_err(|_| "monitor.watch after_cursor must be a decimal u64 string".to_string())
}

fn monitor_list_response(body: ResponseBody) -> Result<MonitorListReceiptV1, String> {
    match body {
        ResponseBody::MonitorList { receipt } => Ok(receipt),
        _ => Err("monitor.list response method mismatch".to_string()),
    }
}

fn monitor_register_response(body: ResponseBody) -> Result<MonitorRegisterReceiptV1, String> {
    match body {
        ResponseBody::MonitorRegister { receipt } => Ok(receipt),
        _ => Err("monitor.register response method mismatch".to_string()),
    }
}

fn monitor_remove_response(body: ResponseBody) -> Result<MonitorRemoveReceiptV1, String> {
    match body {
        ResponseBody::MonitorRemove { receipt } => Ok(receipt),
        _ => Err("monitor.remove response method mismatch".to_string()),
    }
}

fn monitor_watch_response(body: ResponseBody) -> Result<MonitorWatchReceiptV1, String> {
    match body {
        ResponseBody::MonitorWatch { receipt } => Ok(receipt),
        _ => Err("monitor.watch response method mismatch".to_string()),
    }
}

fn session_fleet_response(body: ResponseBody) -> Result<SessionFleetSnapshot, String> {
    match body {
        ResponseBody::SessionFleet { snapshot } => Ok(snapshot),
        _ => Err("session.fleet response method mismatch".to_string()),
    }
}

fn agent_message_response(body: ResponseBody) -> Result<AgentMessageReceipt, String> {
    match body {
        ResponseBody::AgentMessage { receipt } => Ok(receipt),
        _ => Err("agent.message response method mismatch".to_string()),
    }
}

fn session_observe_response(body: ResponseBody) -> Result<Value, String> {
    match body {
        ResponseBody::SessionObserve { digest } => Ok(digest),
        _ => Err("session.observe response method mismatch".to_string()),
    }
}

fn session_observe_batch_response(body: ResponseBody) -> Result<Vec<Value>, String> {
    match body {
        ResponseBody::SessionObserveBatch { digests } => Ok(digests),
        _ => Err("session.observe_batch response method mismatch".to_string()),
    }
}

fn session_observe_request(
    session_id: String,
    last_event_limit: u32,
    metadata_only: bool,
) -> RequestBody {
    RequestBody::SessionObserve {
        session_id,
        last_event_limit,
        metadata_only,
    }
}

fn session_observe_batch_request(
    session_ids: Vec<String>,
    last_event_limit: u32,
    metadata_only: bool,
) -> Result<RequestBody, String> {
    if !(1..=64).contains(&session_ids.len()) {
        return Err("session.observe_batch requires between 1 and 64 session ids".to_string());
    }
    Ok(RequestBody::SessionObserveBatch {
        session_ids,
        last_event_limit,
        metadata_only,
    })
}

fn agent_message_request(
    command_id: String,
    session_id: String,
    worker_generation: u64,
    agent: String,
    text: String,
) -> RequestBody {
    RequestBody::AgentMessage {
        command_id,
        session_id,
        worker_generation,
        agent,
        text,
    }
}

fn session_agent_type_persona_binding_response(
    body: ResponseBody,
    expected_session_id: &str,
) -> Result<SessionAgentTypePersonaBindingReceipt, String> {
    match body {
        ResponseBody::SessionSelectAgentType {
            session_id,
            agent_type,
            selected_seq,
            worker_generation,
        } if session_id == expected_session_id => Ok(SessionAgentTypePersonaBindingReceipt {
            session_id,
            agent_type,
            selected_seq,
            worker_generation,
        }),
        _ => Err("session.select_agent_type response method mismatch".to_string()),
    }
}

#[cfg(unix)]
fn loom_feature_gate(feature: &str) -> FeatureGate {
    FeatureGate::all(BTreeSet::from([feature.to_string()]))
}

#[cfg(unix)]
async fn loom_request(
    method: &str,
    body: RequestBody,
    capability: Capability,
    feature: &str,
) -> Result<ResponseBody, String> {
    match rpc_request_with_feature_gate(
        body,
        capability,
        loom_feature_gate(feature),
        RpcErrorStyle::Public,
    )
    .await
    {
        Some(Ok(response)) => Ok(response),
        Some(Err(error)) => Err(error),
        None => Err(format!("{method} unavailable: no ADE connection")),
    }
}

#[cfg(unix)]
fn loom_typed_transport_error(error: String) -> LoomCommandError {
    if error.starts_with("missing_feature:") {
        LoomCommandError {
            code: "missing_feature".to_string(),
            message: error,
            retryable: false,
            data: None,
        }
    } else if error == "capability_denied" {
        LoomCommandError {
            code: error,
            message: "The current Haider RPC connection lacks the required capability.".to_string(),
            retryable: false,
            data: None,
        }
    } else {
        LoomCommandError::unavailable(error)
    }
}

#[cfg(unix)]
async fn loom_typed_request(
    body: RequestBody,
    capability: Capability,
    features: &[&str],
) -> Result<ResponseBody, LoomCommandError> {
    let features = FeatureGate::all(
        features
            .iter()
            .map(|feature| (*feature).to_string())
            .collect(),
    );
    match rpc_request_with_feature_gate(body, capability, features, RpcErrorStyle::Passthrough)
        .await
    {
        Some(Ok(response)) => Ok(response),
        Some(Err(error)) => Err(loom_typed_transport_error(error)),
        None => Err(LoomCommandError::unavailable(
            "The Loom RPC request did not receive a response.",
        )),
    }
}

fn loom_author_revise_request(
    authoring_id: String,
    expected_revision: u64,
    kind: LoomAuthorKind,
    text: String,
) -> RequestBody {
    RequestBody::LoomAuthorRevise {
        authoring_id,
        expected_revision,
        kind,
        text,
    }
}

fn parse_loom_watch_after_cursor(after_cursor: Option<&str>) -> Result<u64, LoomCommandError> {
    let Some(after_cursor) = after_cursor else {
        return Ok(0);
    };
    if after_cursor.is_empty() || !after_cursor.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(LoomCommandError::protocol(
            "loom.watch after_cursor must be a decimal u64 string",
        ));
    }
    after_cursor.parse::<u64>().map_err(|_| {
        LoomCommandError::protocol("loom.watch after_cursor must be a decimal u64 string")
    })
}

#[cfg(unix)]
async fn fleet_request(
    method: &str,
    body: RequestBody,
    capability: Capability,
    feature: &str,
) -> Result<ResponseBody, String> {
    match rpc_request_with_feature_gate(
        body,
        capability,
        loom_feature_gate(feature),
        RpcErrorStyle::Public,
    )
    .await
    {
        Some(Ok(response)) => Ok(response),
        Some(Err(error)) => Err(error),
        None => Err(format!("{method} unavailable: no ADE connection")),
    }
}

fn workflow_instance_response(body: ResponseBody) -> Result<WorkflowInstanceResult, String> {
    match body {
        ResponseBody::WorkflowInstance { instance } => Ok(WorkflowInstanceResult { instance }),
        _ => Err("workflow.instance response method mismatch".to_string()),
    }
}

fn workflow_graph_state_request(session_id: String, graph_id: Option<String>) -> RequestBody {
    RequestBody::WorkflowGraphState {
        session_id,
        graph_id,
    }
}

fn workflow_graph_watch_request(session_id: String, after_cursor: u64, limit: u32) -> RequestBody {
    RequestBody::WorkflowGraphWatch {
        session_id,
        after_cursor,
        limit,
    }
}

fn parse_workflow_graph_watch_after_cursor(after_cursor: &str) -> Result<u64, String> {
    if after_cursor.is_empty() || !after_cursor.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err("workflow.graph.watch after_cursor must be a decimal u64 string".to_string());
    }
    after_cursor
        .parse::<u64>()
        .map_err(|_| "workflow.graph.watch after_cursor must be a decimal u64 string".to_string())
}

fn workflow_graph_state_response(
    body: ResponseBody,
) -> Result<Option<WorkflowGraphStateV1>, String> {
    match body {
        ResponseBody::WorkflowGraphState { state } => Ok(state),
        _ => Err("workflow.graph.state response method mismatch".to_string()),
    }
}

fn workflow_graph_watch_response(body: ResponseBody) -> Result<WorkflowGraphWatchPageV1, String> {
    match body {
        ResponseBody::WorkflowGraphWatch { page } => Ok(page),
        _ => Err("workflow.graph.watch response method mismatch".to_string()),
    }
}

fn graph_status_response(body: ResponseBody) -> Result<Option<GraphStatus>, String> {
    match body {
        ResponseBody::GraphStatus { status } => Ok(status),
        _ => Err("graph.status response method mismatch".to_string()),
    }
}

fn graph_inspect_response(body: ResponseBody) -> Result<GraphInspectResult, String> {
    match body {
        ResponseBody::GraphInspect {
            snapshot,
            next_cursor,
        } => Ok(GraphInspectResult {
            snapshot,
            next_cursor,
        }),
        _ => Err("graph.inspect response method mismatch".to_string()),
    }
}

impl CheckpointCommandError {
    fn unavailable(message: impl Into<String>) -> Self {
        Self {
            code: "unavailable".to_string(),
            message: message.into(),
            retryable: true,
            data: None,
        }
    }

    fn protocol(message: impl Into<String>) -> Self {
        Self {
            code: "protocol_error".to_string(),
            message: message.into(),
            retryable: false,
            data: None,
        }
    }

    fn from_daemon(code: String, message: String, retryable: bool, data: Option<Value>) -> Self {
        Self {
            code,
            message,
            retryable,
            data: data.map(|raw| {
                serde_json::from_value(raw.clone()).unwrap_or(CheckpointErrorDataV1::Unknown(raw))
            }),
        }
    }

    #[cfg(unix)]
    fn from_workflow(error: WorkflowCommandError) -> Self {
        let data = error
            .data
            .and_then(|data| serde_json::to_value(data).ok())
            .map(|raw| {
                serde_json::from_value(raw.clone()).unwrap_or(CheckpointErrorDataV1::Unknown(raw))
            });
        Self {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
            data,
        }
    }
}

fn checkpoint_response_error(body: ResponseBody, mismatch: &'static str) -> CheckpointCommandError {
    match body {
        ResponseBody::Error {
            code,
            message,
            retryable,
            data,
        } => CheckpointCommandError::from_daemon(code, message, retryable, data),
        _ => CheckpointCommandError::protocol(mismatch),
    }
}

fn checkpoint_list_response(
    body: ResponseBody,
) -> Result<CheckpointListPageV1, CheckpointCommandError> {
    match body {
        ResponseBody::CheckpointList { page } => Ok(page.into()),
        response => Err(checkpoint_response_error(
            response,
            "checkpoint.list response method mismatch",
        )),
    }
}

fn checkpoint_undo_response(
    body: ResponseBody,
) -> Result<CheckpointMutationReceiptV1, CheckpointCommandError> {
    match body {
        ResponseBody::CheckpointUndo { receipt } => Ok(receipt.into()),
        response => Err(checkpoint_response_error(
            response,
            "checkpoint.undo response method mismatch",
        )),
    }
}

fn checkpoint_redo_response(
    body: ResponseBody,
) -> Result<CheckpointMutationReceiptV1, CheckpointCommandError> {
    match body {
        ResponseBody::CheckpointRedo { receipt } => Ok(receipt.into()),
        response => Err(checkpoint_response_error(
            response,
            "checkpoint.redo response method mismatch",
        )),
    }
}

fn checkpoint_rollback_turn_response(
    body: ResponseBody,
) -> Result<CheckpointMutationReceiptV1, CheckpointCommandError> {
    match body {
        ResponseBody::CheckpointRollbackTurn { receipt } => Ok(receipt.into()),
        response => Err(checkpoint_response_error(
            response,
            "checkpoint.rollback_turn response method mismatch",
        )),
    }
}

fn checkpoint_list_request(
    session_id: String,
    branch_id: Option<String>,
    cursor: Option<CheckpointCursorV1>,
    limit: u16,
) -> RequestBody {
    RequestBody::CheckpointList {
        session_id,
        branch_id,
        cursor: cursor.map(|cursor| CheckpointCursorWire(cursor.0)),
        limit,
    }
}

#[cfg(unix)]
fn checkpoint_undo_request(
    attachment: &WorkflowControlAttachment,
    branch_id: Option<String>,
    target: String,
) -> RequestBody {
    RequestBody::CheckpointUndo {
        command_id: config_command_id("checkpoint-undo"),
        session_id: attachment.session_id.clone(),
        branch_id,
        worker_generation: attachment.worker_generation,
        target,
    }
}

#[cfg(unix)]
fn checkpoint_redo_request(
    attachment: &WorkflowControlAttachment,
    branch_id: Option<String>,
    target: String,
) -> RequestBody {
    RequestBody::CheckpointRedo {
        command_id: config_command_id("checkpoint-redo"),
        session_id: attachment.session_id.clone(),
        branch_id,
        worker_generation: attachment.worker_generation,
        target,
    }
}

#[cfg(unix)]
fn checkpoint_rollback_turn_request(
    attachment: &WorkflowControlAttachment,
    branch_id: Option<String>,
    run_id: String,
) -> RequestBody {
    RequestBody::CheckpointRollbackTurn {
        command_id: config_command_id("checkpoint-rollback-turn"),
        session_id: attachment.session_id.clone(),
        branch_id,
        worker_generation: attachment.worker_generation,
        run_id,
    }
}

impl WorkflowCommandError {
    fn unavailable(message: impl Into<String>) -> Self {
        Self {
            code: "unavailable".to_string(),
            message: message.into(),
            retryable: true,
            data: None,
        }
    }

    fn protocol(message: impl Into<String>) -> Self {
        Self {
            code: "protocol_error".to_string(),
            message: message.into(),
            retryable: false,
            data: None,
        }
    }

    fn from_daemon(code: String, message: String, retryable: bool, data: Option<Value>) -> Self {
        let data = data.map(|raw| {
            if code == "revision_conflict"
                && raw.get("kind").and_then(Value::as_str) == Some("workflow_revision_conflict")
            {
                serde_json::from_value(raw.clone()).unwrap_or(WorkflowErrorData::Unknown(raw))
            } else {
                WorkflowErrorData::Unknown(raw)
            }
        });
        Self {
            code,
            message,
            retryable,
            data,
        }
    }
}

fn workflow_response_error(body: ResponseBody, mismatch: &'static str) -> WorkflowCommandError {
    match body {
        ResponseBody::Error {
            code,
            message,
            retryable,
            data,
        } => WorkflowCommandError::from_daemon(code, message, retryable, data),
        _ => WorkflowCommandError::protocol(mismatch),
    }
}

fn graph_pin_response(body: ResponseBody) -> Result<GraphPinReceipt, WorkflowCommandError> {
    match body {
        ResponseBody::GraphPin {
            session_id,
            graph_id,
            template,
            digest,
            pinned_seq,
            opened_seq,
            worker_generation,
        } => Ok(GraphPinReceipt {
            session_id,
            graph_id,
            template,
            digest,
            pinned_seq,
            opened_seq,
            worker_generation,
        }),
        response => Err(workflow_response_error(
            response,
            "graph.pin response method mismatch",
        )),
    }
}

fn graph_switch_response(body: ResponseBody) -> Result<GraphSwitchReceipt, WorkflowCommandError> {
    match body {
        ResponseBody::GraphSwitch {
            session_id,
            old_graph_id,
            new_graph_id,
            template,
            digest,
            superseded_seq,
            pinned_seq,
            opened_seq,
            worker_generation,
        } => Ok(GraphSwitchReceipt {
            session_id,
            old_graph_id,
            new_graph_id,
            template,
            digest,
            superseded_seq,
            pinned_seq,
            opened_seq,
            worker_generation,
        }),
        response => Err(workflow_response_error(
            response,
            "graph.switch response method mismatch",
        )),
    }
}

fn graph_abandon_response(body: ResponseBody) -> Result<GraphAbandonReceipt, WorkflowCommandError> {
    match body {
        ResponseBody::GraphAbandon {
            session_id,
            graph_id,
            abandoned_seq,
            worker_generation,
        } => Ok(GraphAbandonReceipt {
            session_id,
            graph_id,
            abandoned_seq,
            worker_generation,
        }),
        response => Err(workflow_response_error(
            response,
            "graph.abandon response method mismatch",
        )),
    }
}

fn graph_run_set_open_response(
    body: ResponseBody,
) -> Result<GraphRunSetOpenReceipt, WorkflowCommandError> {
    match body {
        ResponseBody::GraphRunSetOpen {
            session_id,
            run_set_id,
            root_graph_id,
            plan_item_id,
            plan_event_seq,
            template,
            digest,
            run_set_opened_seq,
            through_seq,
            children,
            worker_generation,
        } => Ok(GraphRunSetOpenReceipt {
            session_id,
            run_set_id,
            root_graph_id,
            plan_item_id,
            plan_event_seq,
            template,
            digest,
            run_set_opened_seq,
            through_seq,
            children,
            worker_generation,
        }),
        response => Err(workflow_response_error(
            response,
            "graph.run_set.open response method mismatch",
        )),
    }
}

fn loom_workflow_registration_response(
    body: ResponseBody,
) -> Result<LoomRegistrationReceipt, WorkflowCommandError> {
    match body {
        ResponseBody::LoomRegistered {
            registration,
            install_job_id,
        } => Ok(LoomRegistrationReceipt {
            id: registration.id,
            rev: registration.rev,
            digest: registration.digest,
            updated: registration.updated,
            install_job_id,
        }),
        response => Err(workflow_response_error(
            response,
            "loom.register_workflow response method mismatch",
        )),
    }
}

fn graph_selection_expected_digest(
    advertised_features: &BTreeSet<String>,
    expected_digest: Option<String>,
) -> Option<String> {
    advertised_features
        .contains(FEATURE_WORKFLOW_INSTANCE_V1)
        .then_some(expected_digest)
        .flatten()
}

#[allow(clippy::too_many_arguments)]
fn graph_pin_request_for_features(
    command_id: String,
    session_id: String,
    worker_generation: u64,
    template: String,
    expected_digest: Option<String>,
    advertised_features: &BTreeSet<String>,
) -> RequestBody {
    RequestBody::GraphPin {
        command_id,
        session_id,
        worker_generation,
        template,
        expected_digest: graph_selection_expected_digest(advertised_features, expected_digest),
    }
}

#[allow(clippy::too_many_arguments)]
fn graph_switch_request_for_features(
    command_id: String,
    session_id: String,
    worker_generation: u64,
    old_graph_id: String,
    template: String,
    expected_digest: Option<String>,
    advertised_features: &BTreeSet<String>,
) -> RequestBody {
    RequestBody::GraphSwitch {
        command_id,
        session_id,
        worker_generation,
        old_graph_id,
        template,
        expected_digest: graph_selection_expected_digest(advertised_features, expected_digest),
    }
}

#[cfg(unix)]
fn workflow_feature_gate(features: &BTreeSet<String>) -> FeatureGate {
    FeatureGate::all(features.clone())
}

#[cfg(unix)]
fn workflow_rpc_transport_error(error: String) -> WorkflowCommandError {
    if error.starts_with("missing_feature:") {
        WorkflowCommandError {
            code: "missing_feature".to_string(),
            message: error,
            retryable: false,
            data: None,
        }
    } else if error == "capability_denied" {
        WorkflowCommandError {
            code: error,
            message: "The current Haider RPC connection lacks the required capability.".to_string(),
            retryable: false,
            data: None,
        }
    } else {
        WorkflowCommandError::unavailable(error)
    }
}

#[cfg(unix)]
async fn workflow_request(
    body: RequestBody,
    capability: Capability,
    features: &BTreeSet<String>,
) -> Result<ResponseBody, WorkflowCommandError> {
    match rpc_request_with_feature_gate(
        body,
        capability,
        workflow_feature_gate(features),
        RpcErrorStyle::Passthrough,
    )
    .await
    {
        Some(Ok(response)) => Ok(response),
        Some(Err(error)) => Err(workflow_rpc_transport_error(error)),
        None => Err(WorkflowCommandError::unavailable(
            "The workflow RPC request did not receive a response.",
        )),
    }
}

#[cfg(unix)]
fn checkpoint_transport_error(error: String) -> CheckpointCommandError {
    if error.starts_with("missing_feature:") {
        CheckpointCommandError {
            code: "missing_feature".to_string(),
            message: error,
            retryable: false,
            data: None,
        }
    } else if error == "capability_denied" {
        CheckpointCommandError {
            code: error,
            message: "The current Haider RPC connection lacks the required capability.".to_string(),
            retryable: false,
            data: None,
        }
    } else {
        CheckpointCommandError::unavailable(error)
    }
}

#[cfg(unix)]
async fn checkpoint_request(
    body: RequestBody,
    capability: Capability,
) -> Result<ResponseBody, CheckpointCommandError> {
    match rpc_request_with_feature_gate(
        body,
        capability,
        FeatureGate::all(BTreeSet::from([FEATURE_CHECKPOINT_V1.to_string()])),
        RpcErrorStyle::Passthrough,
    )
    .await
    {
        Some(Ok(response)) => Ok(response),
        Some(Err(error)) => Err(checkpoint_transport_error(error)),
        None => Err(CheckpointCommandError::unavailable(
            "The checkpoint RPC request did not receive a response.",
        )),
    }
}

#[cfg(unix)]
async fn checkpoint_provider_session_id(
    session_id: String,
) -> Result<String, CheckpointCommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        super::session_provider_session_id_blocking(&session_id)
    })
    .await
    .map_err(|error| CheckpointCommandError::protocol(format!("Session lookup failed: {error}")))?
    .map_err(|error| CheckpointCommandError::protocol(format!("Session lookup failed: {error}")))
}

#[cfg(unix)]
async fn checkpoint_control_attachment(
    session_id: &str,
) -> Result<WorkflowControlAttachment, CheckpointCommandError> {
    workflow_control_attachment(
        session_id,
        &BTreeSet::from([FEATURE_CHECKPOINT_V1.to_string()]),
    )
    .await
    .map_err(CheckpointCommandError::from_workflow)
}

#[cfg(unix)]
async fn workflow_connection_features() -> Result<BTreeSet<String>, WorkflowCommandError> {
    let handle = actor_handle();
    let mut connection = handle.connection.subscribe();
    if !connection.borrow().connected {
        let _ = tokio::time::timeout(FEATURE_SNIFF_TIMEOUT, async {
            while connection.changed().await.is_ok() {
                if connection.borrow().connected {
                    break;
                }
            }
        })
        .await;
    }
    let snapshot = connection.borrow().clone();
    if snapshot.connected {
        Ok(snapshot.features)
    } else {
        Err(WorkflowCommandError::unavailable(
            "The Haider RPC connection is unavailable.",
        ))
    }
}

#[cfg(unix)]
async fn graph_provider_session_id(session_id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        super::session_provider_session_id_blocking(&session_id)
    })
    .await
    .map_err(|error| format!("Workflow session lookup failed: {error}"))?
    .map_err(|error| format!("Workflow session lookup failed: {error}"))
}

#[cfg(unix)]
async fn fleet_provider_session_id(session_id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        super::session_provider_session_id_blocking(&session_id)
    })
    .await
    .map_err(|error| format!("Fleet session lookup failed: {error}"))?
    .map_err(|error| format!("Fleet session lookup failed: {error}"))
}

#[cfg(unix)]
async fn monitor_provider_session_id(session_id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        super::session_provider_session_id_blocking(&session_id)
    })
    .await
    .map_err(|error| format!("Monitor session lookup failed: {error}"))?
    .map_err(|error| format!("Monitor session lookup failed: {error}"))
}

#[cfg(unix)]
async fn fleet_provider_session_ids(session_ids: Vec<String>) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        session_ids
            .into_iter()
            .map(|session_id| super::session_provider_session_id_blocking(&session_id))
            .collect::<Result<Vec<_>, _>>()
    })
    .await
    .map_err(|error| format!("Fleet session lookup failed: {error}"))?
    .map_err(|error| format!("Fleet session lookup failed: {error}"))
}

#[cfg(unix)]
async fn graph_provider_session_id_for_mutation(
    session_id: String,
) -> Result<String, WorkflowCommandError> {
    graph_provider_session_id(session_id)
        .await
        .map_err(WorkflowCommandError::protocol)
}

#[cfg(unix)]
struct WorkflowControlAttachment {
    attachment_id: String,
    session_id: String,
    worker_generation: u64,
    replay_through_seq: u64,
}

#[cfg(unix)]
async fn workflow_session_summary(
    session_id: &str,
    features: &BTreeSet<String>,
) -> Result<Value, WorkflowCommandError> {
    let mut cursor = None;
    let mut seen_cursors = BTreeSet::new();
    loop {
        let response = workflow_request(
            RequestBody::SessionList { cursor, limit: 256 },
            Capability::Control,
            features,
        )
        .await?;
        let (sessions, next_cursor) = match response {
            ResponseBody::SessionList {
                sessions,
                next_cursor,
            } => (sessions, next_cursor),
            response => {
                return Err(workflow_response_error(
                    response,
                    "session.list response method mismatch while attaching graph control",
                ));
            }
        };
        if let Some(summary) = sessions
            .into_iter()
            .find(|summary| summary.get("session_id").and_then(Value::as_str) == Some(session_id))
        {
            return Ok(summary);
        }
        let Some(next_cursor) = next_cursor else {
            return Err(WorkflowCommandError::protocol(format!(
                "session `{session_id}` was not found"
            )));
        };
        if !seen_cursors.insert(next_cursor.clone()) {
            return Err(WorkflowCommandError::protocol(
                "session.list returned a repeated cursor while attaching graph control",
            ));
        }
        cursor = Some(next_cursor);
    }
}

#[cfg(unix)]
async fn workflow_detach(attachment_id: String) {
    let _ = workflow_request(
        RequestBody::SessionDetach { attachment_id },
        Capability::Control,
        &BTreeSet::new(),
    )
    .await;
}

#[cfg(unix)]
async fn workflow_control_attachment(
    session_id: &str,
    features: &BTreeSet<String>,
) -> Result<WorkflowControlAttachment, WorkflowCommandError> {
    let summary = workflow_session_summary(session_id, features).await?;
    let head_seq = config_u64(summary.get("head_seq"))
        .ok_or_else(|| WorkflowCommandError::protocol("session summary head_seq was missing"))?;
    let response = workflow_request(
        RequestBody::SessionAttach {
            session_id: session_id.to_string(),
            after_seq: head_seq,
            mode: AttachMode::Control,
            sealed_replay: false,
        },
        Capability::Control,
        features,
    )
    .await?;
    let (attachment_id, attach_state) = match response {
        ResponseBody::SessionAttach {
            attachment_id,
            attach_state,
        } => (attachment_id, attach_state),
        response => {
            return Err(workflow_response_error(
                response,
                "session.attach response method mismatch for graph control",
            ));
        }
    };
    if attach_state.session_id != session_id {
        workflow_detach(attachment_id).await;
        return Err(WorkflowCommandError::protocol(
            "session.attach response session mismatch for graph control",
        ));
    }
    Ok(WorkflowControlAttachment {
        attachment_id,
        session_id: attach_state.session_id,
        worker_generation: attach_state.worker_generation,
        replay_through_seq: attach_state.replay_through_seq,
    })
}

impl LifecycleCommandError {
    fn unavailable(message: impl Into<String>) -> Self {
        Self {
            code: "unavailable".to_string(),
            message: message.into(),
            retryable: true,
            data: None,
        }
    }

    fn protocol(message: impl Into<String>) -> Self {
        Self {
            code: "protocol_error".to_string(),
            message: message.into(),
            retryable: false,
            data: None,
        }
    }

    fn invalid_argument(message: impl Into<String>) -> Self {
        Self {
            code: "invalid_argument".to_string(),
            message: message.into(),
            retryable: false,
            data: None,
        }
    }

    fn from_daemon(code: String, message: String, retryable: bool, data: Option<Value>) -> Self {
        Self {
            code,
            message,
            retryable,
            data,
        }
    }

    #[cfg(unix)]
    fn from_workflow(error: WorkflowCommandError) -> Self {
        let data = error.data.and_then(|data| serde_json::to_value(data).ok());
        Self {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
            data,
        }
    }
}

fn lifecycle_response_error(body: ResponseBody, mismatch: &'static str) -> LifecycleCommandError {
    match body {
        ResponseBody::Error {
            code,
            message,
            retryable,
            data,
        } => LifecycleCommandError::from_daemon(code, message, retryable, data),
        _ => LifecycleCommandError::protocol(mismatch),
    }
}

fn session_create_response(
    body: ResponseBody,
) -> Result<SessionCreateReceipt, LifecycleCommandError> {
    match body {
        ResponseBody::SessionCreate {
            session_id,
            created_seq,
            worker_generation,
            metadata,
        } => Ok(SessionCreateReceipt {
            session_id,
            created_seq,
            worker_generation,
            metadata,
        }),
        response => Err(lifecycle_response_error(
            response,
            "session.create response method mismatch",
        )),
    }
}

fn session_rename_response(
    body: ResponseBody,
) -> Result<SessionRenameReceipt, LifecycleCommandError> {
    match body {
        ResponseBody::SessionRename {
            session_id,
            title,
            renamed_seq,
            worker_generation,
        } => Ok(SessionRenameReceipt {
            session_id,
            title,
            renamed_seq,
            worker_generation,
        }),
        response => Err(lifecycle_response_error(
            response,
            "session.rename response method mismatch",
        )),
    }
}

fn session_compact_response(
    body: ResponseBody,
) -> Result<SessionCompactReceipt, LifecycleCommandError> {
    match body {
        ResponseBody::SessionCompact {
            session_id,
            run_id,
            accepted_seq,
            worker_generation,
        } => Ok(SessionCompactReceipt {
            session_id,
            run_id,
            accepted_seq,
            worker_generation,
            branch_id: None,
        }),
        ResponseBody::SessionCompactOnBranch {
            session_id,
            run_id,
            accepted_seq,
            worker_generation,
            branch_id,
        } => Ok(SessionCompactReceipt {
            session_id,
            run_id,
            accepted_seq,
            worker_generation,
            branch_id: Some(branch_id),
        }),
        response => Err(lifecycle_response_error(
            response,
            "session.compact response method mismatch",
        )),
    }
}

fn session_fork_response(body: ResponseBody) -> Result<SessionForkReceipt, LifecycleCommandError> {
    match body {
        ResponseBody::SessionFork {
            session_id,
            source_session_id,
            source_branch_id,
            fork_node_id,
            fork_seq,
            created_seq,
            worker_generation,
            metadata,
            forked_from,
            draft,
        } => Ok(SessionForkReceipt {
            session_id,
            source_session_id,
            source_branch_id,
            fork_node_id,
            fork_seq,
            created_seq,
            worker_generation,
            metadata,
            forked_from,
            draft,
        }),
        response => Err(lifecycle_response_error(
            response,
            "session.fork response method mismatch",
        )),
    }
}

fn run_retry_response(body: ResponseBody) -> Result<RunRetryReceipt, LifecycleCommandError> {
    match body {
        ResponseBody::RunRetry {
            session_id,
            run_id,
            failed_run_id,
            user_seq,
            accepted_seq,
            worker_generation,
        } => Ok(RunRetryReceipt {
            session_id,
            run_id,
            failed_run_id,
            user_seq,
            accepted_seq,
            worker_generation,
        }),
        response => Err(lifecycle_response_error(
            response,
            "run.retry response method mismatch",
        )),
    }
}

fn lifecycle_features(feature: &str) -> BTreeSet<String> {
    BTreeSet::from([feature.to_string()])
}

#[cfg(unix)]
fn session_create_request(
    cwd: String,
    provider: String,
    model: String,
    max_tokens: u64,
    permission_overrides: Option<Value>,
    cache_policy: Option<Value>,
    interaction_mode: Option<String>,
) -> Result<(RequestBody, BTreeSet<String>), LifecycleCommandError> {
    let mut features = lifecycle_features(FEATURE_SESSION_MUTATION_V1);
    if permission_overrides.is_some() {
        features.insert(FEATURE_SESSION_PERMISSION_OVERRIDES_V1.to_string());
    }
    let interaction_mode = match interaction_mode.as_deref() {
        None | Some("interactive") => None,
        Some("autonomous") => {
            features.insert(FEATURE_AUTONOMOUS_INTERACTION_V1.to_string());
            Some("autonomous".to_string())
        }
        Some(other) => {
            return Err(LifecycleCommandError::invalid_argument(format!(
                "session.create interaction_mode must be `interactive` or `autonomous`, got `{other}`"
            )));
        }
    };
    Ok((
        RequestBody::SessionCreate {
            command_id: config_command_id("session-create"),
            cwd,
            provider,
            model,
            max_tokens,
            permission_overrides,
            cache_policy,
            interaction_mode,
        },
        features,
    ))
}

#[cfg(unix)]
fn session_rename_request(
    attachment: &WorkflowControlAttachment,
    title: Option<String>,
) -> RequestBody {
    RequestBody::SessionRename {
        command_id: config_command_id("session-rename"),
        session_id: attachment.session_id.clone(),
        worker_generation: attachment.worker_generation,
        title,
    }
}

#[cfg(unix)]
fn session_compact_request(
    attachment: &WorkflowControlAttachment,
    branch_id: Option<String>,
) -> RequestBody {
    RequestBody::SessionCompact {
        command_id: config_command_id("session-compact"),
        session_id: attachment.session_id.clone(),
        worker_generation: attachment.worker_generation,
        branch_id,
    }
}

#[cfg(unix)]
fn session_fork_request(
    attachment: &WorkflowControlAttachment,
    source_branch_id: Option<String>,
    fork_node_id: Option<String>,
    fork_seq: Option<u64>,
) -> RequestBody {
    RequestBody::SessionFork {
        command_id: config_command_id("session-fork"),
        session_id: attachment.session_id.clone(),
        worker_generation: attachment.worker_generation,
        source_branch_id,
        fork_node_id,
        fork_seq,
    }
}

#[cfg(unix)]
fn run_retry_request(attachment: &WorkflowControlAttachment) -> RequestBody {
    RequestBody::RunRetry {
        command_id: config_command_id("run-retry"),
        session_id: attachment.session_id.clone(),
        worker_generation: attachment.worker_generation,
    }
}

#[cfg(unix)]
fn lifecycle_transport_error(error: String) -> LifecycleCommandError {
    if error.starts_with("missing_feature:") {
        LifecycleCommandError {
            code: "missing_feature".to_string(),
            message: error,
            retryable: false,
            data: None,
        }
    } else if error == "capability_denied" {
        LifecycleCommandError {
            code: error,
            message: "The current Haider RPC connection lacks Control capability.".to_string(),
            retryable: false,
            data: None,
        }
    } else {
        LifecycleCommandError::unavailable(error)
    }
}

#[cfg(unix)]
async fn lifecycle_request(
    body: RequestBody,
    features: &BTreeSet<String>,
) -> Result<ResponseBody, LifecycleCommandError> {
    match rpc_request_with_feature_gate(
        body,
        Capability::Control,
        FeatureGate::all(features.clone()),
        RpcErrorStyle::Passthrough,
    )
    .await
    {
        Some(Ok(response)) => Ok(response),
        Some(Err(error)) => Err(lifecycle_transport_error(error)),
        None => Err(LifecycleCommandError::unavailable(
            "The lifecycle RPC request did not receive a response.",
        )),
    }
}

#[cfg(unix)]
async fn lifecycle_provider_session_id(
    session_id: String,
) -> Result<String, LifecycleCommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        super::session_provider_session_id_blocking(&session_id)
    })
    .await
    .map_err(|error| LifecycleCommandError::protocol(format!("Session lookup failed: {error}")))?
    .map_err(|error| LifecycleCommandError::protocol(format!("Session lookup failed: {error}")))
}

#[cfg(unix)]
async fn lifecycle_control_attachment(
    session_id: &str,
    features: &BTreeSet<String>,
) -> Result<WorkflowControlAttachment, LifecycleCommandError> {
    workflow_control_attachment(session_id, features)
        .await
        .map_err(LifecycleCommandError::from_workflow)
}

fn lifecycle_fork_seq_in_envelopes(
    envelopes: &[Value],
    requested_node_id: &str,
) -> Result<Option<u64>, LifecycleCommandError> {
    for envelope in envelopes {
        let payload = envelope.get("payload").unwrap_or(&Value::Null);
        if payload.get("type").and_then(Value::as_str) != Some("node_committed")
            || payload
                .get("node")
                .and_then(|node| node.get("node"))
                .and_then(Value::as_str)
                != Some(requested_node_id)
        {
            continue;
        }
        return config_u64(envelope.get("seq")).map(Some).ok_or_else(|| {
            LifecycleCommandError::protocol(format!(
                "session.read node `{requested_node_id}` omitted its authoritative sequence"
            ))
        });
    }
    Ok(None)
}

#[cfg(unix)]
async fn lifecycle_fork_seq(
    attachment: &WorkflowControlAttachment,
    requested_node_id: &str,
    features: &BTreeSet<String>,
) -> Result<u64, LifecycleCommandError> {
    const PAGE_SIZE: u64 = 1_024;
    let mut end_seq = attachment.replay_through_seq;
    while end_seq != 0 {
        let start_seq = end_seq.saturating_sub(PAGE_SIZE - 1).max(1);
        let result = match lifecycle_request(
            RequestBody::SessionRead {
                session_id: attachment.session_id.clone(),
                range: SessionReadRange { start_seq, end_seq },
            },
            features,
        )
        .await?
        {
            ResponseBody::SessionRead { result } => result,
            response => {
                return Err(lifecycle_response_error(
                    response,
                    "session.read response method mismatch while resolving fork cut",
                ));
            }
        };
        if result.session_id != attachment.session_id {
            return Err(LifecycleCommandError::protocol(
                "session.read response session mismatch while resolving fork cut",
            ));
        }
        if let Some(fork_seq) =
            lifecycle_fork_seq_in_envelopes(&result.envelopes, requested_node_id)?
        {
            return Ok(fork_seq);
        }
        end_seq = start_seq.saturating_sub(1);
    }
    Err(LifecycleCommandError::invalid_argument(format!(
        "session.fork node `{requested_node_id}` was absent from the attached journal snapshot"
    )))
}

/// Create a daemon-owned session. The command id is minted inside the SDK;
/// there is no pre-existing session from which to obtain a Control attachment.
#[allow(clippy::too_many_arguments)]
pub async fn session_create(
    cwd: String,
    provider: String,
    model: String,
    max_tokens: u64,
    permission_overrides: Option<Value>,
    cache_policy: Option<Value>,
    interaction_mode: Option<String>,
) -> Result<SessionCreateReceipt, LifecycleCommandError> {
    #[cfg(unix)]
    {
        let (request, features) = session_create_request(
            cwd,
            provider,
            model,
            max_tokens,
            permission_overrides,
            cache_policy,
            interaction_mode,
        )?;
        return session_create_response(lifecycle_request(request, &features).await?);
    }
    #[cfg(not(unix))]
    {
        let _ = (
            cwd,
            provider,
            model,
            max_tokens,
            permission_overrides,
            cache_policy,
            interaction_mode,
        );
        Err(LifecycleCommandError::unavailable(
            "session.create unavailable on this platform",
        ))
    }
}

/// Tauri registration wrapper. Its Rust identifier must differ from the
/// legacy crate-root `session_create` command because Tauri exports helper
/// macros by Rust identifier even when the dispatch string is renamed.
#[tauri::command(rename = "ade_session_create", rename_all = "snake_case")]
#[allow(clippy::too_many_arguments)]
pub async fn lifecycle_session_create_command(
    cwd: String,
    provider: String,
    model: String,
    max_tokens: u64,
    permission_overrides: Option<Value>,
    cache_policy: Option<Value>,
    interaction_mode: Option<String>,
) -> Result<SessionCreateReceipt, LifecycleCommandError> {
    session_create(
        cwd,
        provider,
        model,
        max_tokens,
        permission_overrides,
        cache_policy,
        interaction_mode,
    )
    .await
}

/// Rename or clear a live session title. `None` is passed as an omitted wire
/// key, which is the daemon-documented clear operation.
pub async fn session_rename(
    session_id: String,
    title: Option<String>,
) -> Result<SessionRenameReceipt, LifecycleCommandError> {
    #[cfg(unix)]
    {
        let provider_session_id = lifecycle_provider_session_id(session_id).await?;
        let features = lifecycle_features(FEATURE_SESSION_RENAME_V1);
        let attachment = lifecycle_control_attachment(&provider_session_id, &features).await?;
        let result = lifecycle_request(session_rename_request(&attachment, title), &features)
            .await
            .and_then(session_rename_response);
        workflow_detach(attachment.attachment_id).await;
        return result;
    }
    #[cfg(not(unix))]
    {
        let _ = (session_id, title);
        Err(LifecycleCommandError::unavailable(
            "session.rename unavailable on this platform",
        ))
    }
}

/// Collision-free Tauri registration wrapper for the ADE rename SDK.
#[tauri::command(rename = "ade_session_rename", rename_all = "snake_case")]
pub async fn lifecycle_session_rename_command(
    session_id: String,
    title: Option<String>,
) -> Result<SessionRenameReceipt, LifecycleCommandError> {
    session_rename(session_id, title).await
}

/// Start durable manual context compaction on the main or a named branch.
#[tauri::command(rename_all = "snake_case")]
pub async fn session_compact(
    session_id: String,
    branch_id: Option<String>,
) -> Result<SessionCompactReceipt, LifecycleCommandError> {
    #[cfg(unix)]
    {
        let provider_session_id = lifecycle_provider_session_id(session_id).await?;
        let features = lifecycle_features(FEATURE_CONTEXT_COMPACTION_V1);
        let attachment = lifecycle_control_attachment(&provider_session_id, &features).await?;
        let result = lifecycle_request(session_compact_request(&attachment, branch_id), &features)
            .await
            .and_then(session_compact_response);
        workflow_detach(attachment.attachment_id).await;
        return result;
    }
    #[cfg(not(unix))]
    {
        let _ = (session_id, branch_id);
        Err(LifecycleCommandError::unavailable(
            "session.compact unavailable on this platform",
        ))
    }
}

/// Fork an exact journal node into a new daemon-minted session. When supplied,
/// the numeric cut is resolved from the daemon journal and never accepted from
/// JavaScript. Omitted selectors remain omitted for daemon-side shape checks.
#[tauri::command(rename_all = "snake_case")]
pub async fn session_fork(
    session_id: String,
    source_branch_id: Option<String>,
    fork_node_id: Option<String>,
) -> Result<SessionForkReceipt, LifecycleCommandError> {
    #[cfg(unix)]
    {
        let provider_session_id = lifecycle_provider_session_id(session_id).await?;
        let features = lifecycle_features(FEATURE_SESSION_FORK_V1);
        let attachment = lifecycle_control_attachment(&provider_session_id, &features).await?;
        let result = async {
            let fork_seq = match fork_node_id.as_deref() {
                Some(fork_node_id) => {
                    Some(lifecycle_fork_seq(&attachment, fork_node_id, &features).await?)
                }
                None => None,
            };
            lifecycle_request(
                session_fork_request(&attachment, source_branch_id, fork_node_id, fork_seq),
                &features,
            )
            .await
            .and_then(session_fork_response)
        }
        .await;
        workflow_detach(attachment.attachment_id).await;
        return result;
    }
    #[cfg(not(unix))]
    {
        let _ = (session_id, source_branch_id, fork_node_id);
        Err(LifecycleCommandError::unavailable(
            "session.fork unavailable on this platform",
        ))
    }
}

/// Retry the latest failed main-timeline turn or wake the current backoff.
#[tauri::command(rename_all = "snake_case")]
pub async fn run_retry(session_id: String) -> Result<RunRetryReceipt, LifecycleCommandError> {
    #[cfg(unix)]
    {
        let provider_session_id = lifecycle_provider_session_id(session_id).await?;
        let features = lifecycle_features(FEATURE_RUN_RETRY_V1);
        let attachment = lifecycle_control_attachment(&provider_session_id, &features).await?;
        let result = lifecycle_request(run_retry_request(&attachment), &features)
            .await
            .and_then(run_retry_response);
        workflow_detach(attachment.attachment_id).await;
        return result;
    }
    #[cfg(not(unix))]
    {
        let _ = session_id;
        Err(LifecycleCommandError::unavailable(
            "run.retry unavailable on this platform",
        ))
    }
}

/// Read only the P0.3 agent-type registry and advisory CLI-presence map.
/// Workflow records are deliberately left to P0.4.
#[tauri::command(rename_all = "snake_case")]
pub async fn loom_list(include_archived: Option<bool>) -> Result<LoomListResult, LoomCommandError> {
    let include_archived = include_archived.unwrap_or(false);
    #[cfg(unix)]
    {
        let features = if include_archived {
            &[FEATURE_LOOM_V1, FEATURE_LOOM_REGISTRY_ARCHIVE_V1][..]
        } else {
            &[FEATURE_LOOM_V1][..]
        };
        return loom_list_response_for_request(
            loom_typed_request(
                RequestBody::LoomList { include_archived },
                Capability::View,
                features,
            )
            .await?,
            include_archived,
        )
        .map_err(LoomCommandError::protocol);
    }
    #[cfg(not(unix))]
    {
        let _ = include_archived;
        Err(LoomCommandError::unavailable(
            "loom.list unavailable on this platform",
        ))
    }
}

/// Read the daemon's bounded descendant tree. An available empty snapshot is
/// genuine emptiness; feature or transport absence is returned as an error.
#[tauri::command(rename_all = "snake_case")]
pub async fn session_fleet(session_id: String) -> Result<SessionFleetSnapshot, String> {
    #[cfg(unix)]
    {
        let provider_session_id = fleet_provider_session_id(session_id).await?;
        return session_fleet_response(
            fleet_request(
                "session.fleet",
                RequestBody::SessionFleet {
                    session_id: provider_session_id,
                },
                Capability::View,
                FEATURE_SESSION_FLEET_V1,
            )
            .await?,
        );
    }
    #[cfg(not(unix))]
    {
        let _ = session_id;
        Err("session.fleet unavailable on this platform".to_string())
    }
}

/// Attach the invoking webview to the daemon's reconnectable descendant
/// stream. Registration happens in the socket actor before the correlated
/// response is released, so buffered pushes cannot overtake the forwarder.
#[tauri::command(rename_all = "snake_case")]
pub async fn session_descendants_attach(
    app: AppHandle,
    session_id: String,
    cursors: Vec<DescendantReplayCursor>,
    max_children: u32,
) -> Result<SessionDescendantsAttachment, String> {
    if max_children == 0 {
        return Err("session.descendants.attach max_children must be positive".to_string());
    }
    let cursors = descendant_replay_cursors_wire(cursors)?;
    #[cfg(unix)]
    {
        let session_id = fleet_provider_session_id(session_id).await?;
        let (reply, answer) = oneshot::channel();
        actor_handle()
            .commands
            .send(ActorCommand::DescendantAttach {
                app,
                session_id,
                cursors,
                max_children,
                reply,
            })
            .map_err(|_| "session.descendants.attach actor is unavailable".to_string())?;
        return match tokio::time::timeout(COMMAND_REPLY_TIMEOUT, answer).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(
                "session.descendants.attach actor dropped its response confirmation".to_string(),
            ),
            Err(_) => Err("session.descendants.attach did not respond in time".to_string()),
        };
    }
    #[cfg(not(unix))]
    {
        let _ = (app, session_id, cursors, max_children);
        Err("session.descendants.attach unavailable on this platform".to_string())
    }
}

/// End a descendant attachment owned by this ADE connection. The actor keeps
/// forwarding until the daemon's detach barrier echoes the same id, then
/// removes the local attachment bookkeeping before returning.
#[tauri::command(rename_all = "snake_case")]
pub async fn session_descendants_detach(attachment_id: String) -> Result<(), String> {
    #[cfg(unix)]
    {
        let (reply, answer) = oneshot::channel();
        actor_handle()
            .commands
            .send(ActorCommand::DescendantDetach {
                attachment_id,
                reply,
            })
            .map_err(|_| "session_descendants_detach actor is unavailable".to_string())?;
        return match tokio::time::timeout(COMMAND_REPLY_TIMEOUT, answer).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => {
                Err("session_descendants_detach actor dropped its confirmation".to_string())
            }
            Err(_) => Err("session_descendants_detach did not respond in time".to_string()),
        };
    }
    #[cfg(not(unix))]
    {
        let _ = attachment_id;
        Err("session_descendants_detach unavailable on this platform".to_string())
    }
}

/// Read one complete observation digest without rebuilding the daemon's
/// projection locally. Metadata-only defaults remain authority-defined.
#[tauri::command(rename_all = "snake_case")]
pub async fn session_observe(
    session_id: String,
    last_event_limit: u32,
    metadata_only: bool,
) -> Result<Value, String> {
    #[cfg(unix)]
    {
        let provider_session_id = fleet_provider_session_id(session_id).await?;
        return session_observe_response(
            fleet_request(
                "session.observe",
                session_observe_request(provider_session_id, last_event_limit, metadata_only),
                Capability::View,
                FEATURE_SESSION_OBSERVE_V1,
            )
            .await?,
        );
    }
    #[cfg(not(unix))]
    {
        let _ = (session_id, last_event_limit, metadata_only);
        Err("session.observe unavailable on this platform".to_string())
    }
}

/// Read 1..=64 observation digests in the exact request order. Each digest
/// remains verbatim because its nested projection is daemon authority.
#[tauri::command(rename_all = "snake_case")]
pub async fn session_observe_batch(
    session_ids: Vec<String>,
    last_event_limit: u32,
    metadata_only: bool,
) -> Result<Vec<Value>, String> {
    #[cfg(unix)]
    {
        session_observe_batch_request(session_ids.clone(), last_event_limit, metadata_only)?;
        let provider_session_ids = fleet_provider_session_ids(session_ids).await?;
        return session_observe_batch_response(
            fleet_request(
                "session.observe_batch",
                session_observe_batch_request(
                    provider_session_ids,
                    last_event_limit,
                    metadata_only,
                )?,
                Capability::View,
                FEATURE_SESSION_OBSERVE_BATCH_V1,
            )
            .await?,
        );
    }
    #[cfg(not(unix))]
    {
        let _ = (session_ids, last_event_limit, metadata_only);
        Err("session.observe_batch unavailable on this platform".to_string())
    }
}

/// Message one direct child through a current control attachment. The
/// command id and worker generation are minted/read internally and are never
/// accepted from JS.
#[tauri::command(rename_all = "snake_case")]
pub async fn agent_message(
    session_id: String,
    agent: String,
    text: String,
) -> Result<AgentMessageReceipt, String> {
    #[cfg(unix)]
    {
        let provider_session_id = fleet_provider_session_id(session_id).await?;
        let features = BTreeSet::from([FEATURE_AGENT_MESSAGE_V1.to_string()]);
        let attachment = workflow_control_attachment(&provider_session_id, &features)
            .await
            .map_err(|error| error.message)?;
        let response = fleet_request(
            "agent.message",
            agent_message_request(
                config_command_id("agent-message"),
                attachment.session_id.clone(),
                attachment.worker_generation,
                agent,
                text,
            ),
            Capability::Control,
            FEATURE_AGENT_MESSAGE_V1,
        )
        .await;
        let result = match response {
            Ok(body) => agent_message_response(body),
            Err(error) => Err(error),
        };
        workflow_detach(attachment.attachment_id).await;
        return result;
    }
    #[cfg(not(unix))]
    {
        let _ = (session_id, agent, text);
        Err("agent.message unavailable on this platform".to_string())
    }
}

/// Read an exact daemon-owned workflow revision. Feature-gate failure is an
/// unavailable read, never permission to compile or substitute a local row.
#[tauri::command(rename_all = "snake_case")]
pub async fn workflow_instance_get(
    workflow_id: String,
    template_digest: Option<String>,
) -> Result<WorkflowInstanceResult, String> {
    #[cfg(unix)]
    {
        return workflow_instance_response(
            loom_request(
                "workflow.instance",
                RequestBody::WorkflowInstance {
                    workflow_id,
                    template_digest,
                },
                Capability::View,
                FEATURE_WORKFLOW_INSTANCE_V1,
            )
            .await?,
        );
    }
    #[cfg(not(unix))]
    {
        let _ = (workflow_id, template_digest);
        Err("workflow.instance unavailable on this platform".to_string())
    }
}

/// Read one daemon-indexed activation graph. `None` is honest absence for the
/// requested graph or the session's most-recently-changed graph.
#[tauri::command(rename_all = "snake_case")]
pub async fn workflow_graph_state(
    session_id: String,
    graph_id: Option<String>,
) -> Result<Option<WorkflowGraphStateV1>, String> {
    #[cfg(unix)]
    {
        let provider_session_id = graph_provider_session_id(session_id).await?;
        return workflow_graph_state_response(
            loom_request(
                "workflow.graph.state",
                workflow_graph_state_request(provider_session_id, graph_id),
                Capability::View,
                FEATURE_WORKFLOW_GRAPH_V1,
            )
            .await?,
        );
    }
    #[cfg(not(unix))]
    {
        let _ = (session_id, graph_id);
        Err("workflow.graph.state unavailable on this platform".to_string())
    }
}

/// Replay daemon journal facts after an applied cursor. Every returned cursor
/// and event payload is passed through without client-side interpretation.
#[tauri::command(rename_all = "snake_case")]
pub async fn workflow_graph_watch(
    session_id: String,
    after_cursor: String,
    limit: u32,
) -> Result<WorkflowGraphWatchPageV1, String> {
    let after_cursor = parse_workflow_graph_watch_after_cursor(&after_cursor)?;
    #[cfg(unix)]
    {
        let provider_session_id = graph_provider_session_id(session_id).await?;
        return workflow_graph_watch_response(
            loom_request(
                "workflow.graph.watch",
                workflow_graph_watch_request(provider_session_id, after_cursor, limit),
                Capability::View,
                FEATURE_WORKFLOW_GRAPH_V1,
            )
            .await?,
        );
    }
    #[cfg(not(unix))]
    {
        let _ = (session_id, after_cursor, limit);
        Err("workflow.graph.watch unavailable on this platform".to_string())
    }
}

/// Read the authoritative durable monitor registry. Only a `listed` outcome
/// carries a monitor set; rejected and future outcomes retain that distinction.
#[tauri::command(rename_all = "snake_case")]
pub async fn monitor_list(session_id: String) -> Result<MonitorListReceiptV1, String> {
    #[cfg(unix)]
    {
        let provider_session_id = monitor_provider_session_id(session_id).await?;
        return monitor_list_response(
            fleet_request(
                "monitor.list",
                monitor_list_request(provider_session_id),
                Capability::View,
                FEATURE_MONITOR_CONTROL_V1,
            )
            .await?,
        );
    }
    #[cfg(not(unix))]
    {
        let _ = session_id;
        Err("monitor.list unavailable on this platform".to_string())
    }
}

/// Register through a fresh live Control attachment. Durable command and
/// worker-generation coordinates are internal and never accepted from JS.
#[tauri::command(rename_all = "snake_case")]
pub async fn monitor_register(
    session_id: String,
    source: Value,
    filter: Option<Value>,
    action: Value,
    occurrence: Value,
    lifetime: Value,
) -> Result<MonitorRegisterReceiptV1, String> {
    #[cfg(unix)]
    {
        let provider_session_id = monitor_provider_session_id(session_id).await?;
        let features = BTreeSet::from([FEATURE_MONITOR_CONTROL_V1.to_string()]);
        let attachment = workflow_control_attachment(&provider_session_id, &features)
            .await
            .map_err(|error| error.message)?;
        let response = fleet_request(
            "monitor.register",
            monitor_register_request(
                config_command_id("monitor-register"),
                attachment.session_id.clone(),
                attachment.worker_generation,
                source,
                filter,
                action,
                occurrence,
                lifetime,
            ),
            Capability::Control,
            FEATURE_MONITOR_CONTROL_V1,
        )
        .await;
        let result = match response {
            Ok(body) => monitor_register_response(body),
            Err(error) => Err(error),
        };
        workflow_detach(attachment.attachment_id).await;
        return result;
    }
    #[cfg(not(unix))]
    {
        let _ = (session_id, source, filter, action, occurrence, lifetime);
        Err("monitor.register unavailable on this platform".to_string())
    }
}

/// Remove through a fresh live Control attachment. The daemon receipt keeps
/// not-found and other structured refusals as ordinary typed outcome data.
#[tauri::command(rename_all = "snake_case")]
pub async fn monitor_remove(
    session_id: String,
    monitor_id: String,
) -> Result<MonitorRemoveReceiptV1, String> {
    #[cfg(unix)]
    {
        let provider_session_id = monitor_provider_session_id(session_id).await?;
        let features = BTreeSet::from([FEATURE_MONITOR_CONTROL_V1.to_string()]);
        let attachment = workflow_control_attachment(&provider_session_id, &features)
            .await
            .map_err(|error| error.message)?;
        let response = fleet_request(
            "monitor.remove",
            monitor_remove_request(
                config_command_id("monitor-remove"),
                attachment.session_id.clone(),
                attachment.worker_generation,
                monitor_id,
            ),
            Capability::Control,
            FEATURE_MONITOR_CONTROL_V1,
        )
        .await;
        let result = match response {
            Ok(body) => monitor_remove_response(body),
            Err(error) => Err(error),
        };
        workflow_detach(attachment.attachment_id).await;
        return result;
    }
    #[cfg(not(unix))]
    {
        let _ = (session_id, monitor_id);
        Err("monitor.remove unavailable on this platform".to_string())
    }
}

/// Start replay strictly after the greatest fully applied journal cursor.
/// Tauri accepts a decimal string; only the daemon-facing request uses u64.
#[tauri::command(rename_all = "snake_case")]
pub async fn monitor_watch(
    session_id: String,
    after_cursor: String,
) -> Result<MonitorWatchReceiptV1, String> {
    let after_cursor = parse_monitor_watch_after_cursor(&after_cursor)?;
    #[cfg(unix)]
    {
        let provider_session_id = monitor_provider_session_id(session_id).await?;
        return monitor_watch_response(
            fleet_request(
                "monitor.watch",
                monitor_watch_request(provider_session_id, after_cursor),
                Capability::View,
                FEATURE_MONITOR_DELIVERY_V1,
            )
            .await?,
        );
    }
    #[cfg(not(unix))]
    {
        let _ = (session_id, after_cursor);
        Err("monitor.watch unavailable on this platform".to_string())
    }
}

/// List daemon-authored checkpoints newest first. The optional cursor crosses
/// Tauri as an exact decimal string and is checked before becoming wire `u64`.
#[tauri::command(rename_all = "snake_case")]
pub async fn checkpoint_list(
    session_id: String,
    branch_id: Option<String>,
    cursor: Option<CheckpointCursorV1>,
    limit: u16,
) -> Result<CheckpointListPageV1, CheckpointCommandError> {
    #[cfg(unix)]
    {
        let provider_session_id = checkpoint_provider_session_id(session_id).await?;
        return checkpoint_list_response(
            checkpoint_request(
                checkpoint_list_request(provider_session_id, branch_id, cursor, limit),
                Capability::View,
            )
            .await?,
        );
    }
    #[cfg(not(unix))]
    {
        let _ = (session_id, branch_id, cursor, limit);
        Err(CheckpointCommandError::unavailable(
            "checkpoint.list unavailable on this platform",
        ))
    }
}

/// Restore one checkpoint pre-image using fresh Control attachment fences.
#[tauri::command(rename_all = "snake_case")]
pub async fn checkpoint_undo(
    session_id: String,
    branch_id: Option<String>,
    target: String,
) -> Result<CheckpointMutationReceiptV1, CheckpointCommandError> {
    #[cfg(unix)]
    {
        let provider_session_id = checkpoint_provider_session_id(session_id).await?;
        let attachment = checkpoint_control_attachment(&provider_session_id).await?;
        let result = checkpoint_request(
            checkpoint_undo_request(&attachment, branch_id, target),
            Capability::Control,
        )
        .await
        .and_then(checkpoint_undo_response);
        workflow_detach(attachment.attachment_id).await;
        return result;
    }
    #[cfg(not(unix))]
    {
        let _ = (session_id, branch_id, target);
        Err(CheckpointCommandError::unavailable(
            "checkpoint.undo unavailable on this platform",
        ))
    }
}

/// Reapply an append-only undo/rollback checkpoint with daemon digest guards.
#[tauri::command(rename_all = "snake_case")]
pub async fn checkpoint_redo(
    session_id: String,
    branch_id: Option<String>,
    target: String,
) -> Result<CheckpointMutationReceiptV1, CheckpointCommandError> {
    #[cfg(unix)]
    {
        let provider_session_id = checkpoint_provider_session_id(session_id).await?;
        let attachment = checkpoint_control_attachment(&provider_session_id).await?;
        let result = checkpoint_request(
            checkpoint_redo_request(&attachment, branch_id, target),
            Capability::Control,
        )
        .await
        .and_then(checkpoint_redo_response);
        workflow_detach(attachment.attachment_id).await;
        return result;
    }
    #[cfg(not(unix))]
    {
        let _ = (session_id, branch_id, target);
        Err(CheckpointCommandError::unavailable(
            "checkpoint.redo unavailable on this platform",
        ))
    }
}

/// Atomically roll back every checkpoint from one turn after full preflight.
#[tauri::command(rename_all = "snake_case")]
pub async fn checkpoint_rollback_turn(
    session_id: String,
    branch_id: Option<String>,
    run_id: String,
) -> Result<CheckpointMutationReceiptV1, CheckpointCommandError> {
    #[cfg(unix)]
    {
        let provider_session_id = checkpoint_provider_session_id(session_id).await?;
        let attachment = checkpoint_control_attachment(&provider_session_id).await?;
        let result = checkpoint_request(
            checkpoint_rollback_turn_request(&attachment, branch_id, run_id),
            Capability::Control,
        )
        .await
        .and_then(checkpoint_rollback_turn_response);
        workflow_detach(attachment.attachment_id).await;
        return result;
    }
    #[cfg(not(unix))]
    {
        let _ = (session_id, branch_id, run_id);
        Err(CheckpointCommandError::unavailable(
            "checkpoint.rollback_turn unavailable on this platform",
        ))
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn graph_status(session_id: String) -> Result<Option<GraphStatus>, String> {
    #[cfg(unix)]
    {
        let provider_session_id = graph_provider_session_id(session_id).await?;
        return graph_status_response(
            loom_request(
                "graph.status",
                RequestBody::GraphStatus {
                    session_id: provider_session_id,
                },
                Capability::View,
                FEATURE_CONVERGENCE_GRAPH_V1,
            )
            .await?,
        );
    }
    #[cfg(not(unix))]
    {
        let _ = session_id;
        Err("graph.status unavailable on this platform".to_string())
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn graph_inspect(
    session_id: String,
    cursor: Option<String>,
    limit: u32,
) -> Result<GraphInspectResult, String> {
    #[cfg(unix)]
    {
        let provider_session_id = graph_provider_session_id(session_id).await?;
        return graph_inspect_response(
            loom_request(
                "graph.inspect",
                RequestBody::GraphInspect {
                    session_id: provider_session_id,
                    cursor,
                    limit,
                },
                Capability::View,
                FEATURE_CONVERGENCE_GRAPH_V3,
            )
            .await?,
        );
    }
    #[cfg(not(unix))]
    {
        let _ = (session_id, cursor, limit);
        Err("graph.inspect unavailable on this platform".to_string())
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn graph_pin(
    session_id: String,
    template: String,
    expected_digest: Option<String>,
) -> Result<GraphPinReceipt, WorkflowCommandError> {
    #[cfg(unix)]
    {
        let provider_session_id = graph_provider_session_id_for_mutation(session_id).await?;
        let advertised_features = workflow_connection_features().await?;
        let base_features = BTreeSet::from([FEATURE_CONVERGENCE_GRAPH_V1.to_string()]);
        let attachment = workflow_control_attachment(&provider_session_id, &base_features).await?;
        let fenced =
            expected_digest.is_some() && advertised_features.contains(FEATURE_WORKFLOW_INSTANCE_V1);
        let request = graph_pin_request_for_features(
            config_command_id("graph-pin"),
            attachment.session_id.clone(),
            attachment.worker_generation,
            template,
            expected_digest,
            &advertised_features,
        );
        let mut mutation_features = base_features;
        if fenced {
            mutation_features.insert(FEATURE_WORKFLOW_INSTANCE_V1.to_string());
        }
        let response = workflow_request(request, Capability::Control, &mutation_features).await;
        let result = match response {
            Ok(body) => graph_pin_response(body),
            Err(error) => Err(error),
        };
        workflow_detach(attachment.attachment_id).await;
        return result;
    }
    #[cfg(not(unix))]
    {
        let _ = (session_id, template, expected_digest);
        Err(WorkflowCommandError::unavailable(
            "graph.pin unavailable on this platform",
        ))
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn graph_switch(
    session_id: String,
    old_graph_id: String,
    template: String,
    expected_digest: Option<String>,
) -> Result<GraphSwitchReceipt, WorkflowCommandError> {
    #[cfg(unix)]
    {
        let provider_session_id = graph_provider_session_id_for_mutation(session_id).await?;
        let advertised_features = workflow_connection_features().await?;
        let base_features = BTreeSet::from([FEATURE_CONVERGENCE_GRAPH_V2.to_string()]);
        let attachment = workflow_control_attachment(&provider_session_id, &base_features).await?;
        let fenced =
            expected_digest.is_some() && advertised_features.contains(FEATURE_WORKFLOW_INSTANCE_V1);
        let request = graph_switch_request_for_features(
            config_command_id("graph-switch"),
            attachment.session_id.clone(),
            attachment.worker_generation,
            old_graph_id,
            template,
            expected_digest,
            &advertised_features,
        );
        let mut mutation_features = base_features;
        if fenced {
            mutation_features.insert(FEATURE_WORKFLOW_INSTANCE_V1.to_string());
        }
        let response = workflow_request(request, Capability::Control, &mutation_features).await;
        let result = match response {
            Ok(body) => graph_switch_response(body),
            Err(error) => Err(error),
        };
        workflow_detach(attachment.attachment_id).await;
        return result;
    }
    #[cfg(not(unix))]
    {
        let _ = (session_id, old_graph_id, template, expected_digest);
        Err(WorkflowCommandError::unavailable(
            "graph.switch unavailable on this platform",
        ))
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn graph_abandon(
    session_id: String,
    why: String,
) -> Result<GraphAbandonReceipt, WorkflowCommandError> {
    #[cfg(unix)]
    {
        let provider_session_id = graph_provider_session_id_for_mutation(session_id).await?;
        let features = BTreeSet::from([FEATURE_CONVERGENCE_GRAPH_V1.to_string()]);
        let attachment = workflow_control_attachment(&provider_session_id, &features).await?;
        let response = workflow_request(
            RequestBody::GraphAbandon {
                command_id: config_command_id("graph-abandon"),
                session_id: attachment.session_id.clone(),
                worker_generation: attachment.worker_generation,
                why,
            },
            Capability::Control,
            &features,
        )
        .await;
        let result = match response {
            Ok(body) => graph_abandon_response(body),
            Err(error) => Err(error),
        };
        workflow_detach(attachment.attachment_id).await;
        return result;
    }
    #[cfg(not(unix))]
    {
        let _ = (session_id, why);
        Err(WorkflowCommandError::unavailable(
            "graph.abandon unavailable on this platform",
        ))
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn graph_run_set_open(
    session_id: String,
    plan_item_id: String,
    plan_event_seq: u64,
) -> Result<GraphRunSetOpenReceipt, WorkflowCommandError> {
    #[cfg(unix)]
    {
        let provider_session_id = graph_provider_session_id_for_mutation(session_id).await?;
        let features = BTreeSet::from([FEATURE_CONVERGENCE_GRAPH_V4.to_string()]);
        let attachment = workflow_control_attachment(&provider_session_id, &features).await?;
        let response = workflow_request(
            RequestBody::GraphRunSetOpen {
                command_id: config_command_id("graph-run-set-open"),
                session_id: attachment.session_id.clone(),
                worker_generation: attachment.worker_generation,
                plan_item_id,
                plan_event_seq,
            },
            Capability::Control,
            &features,
        )
        .await;
        let result = match response {
            Ok(body) => graph_run_set_open_response(body),
            Err(error) => Err(error),
        };
        workflow_detach(attachment.attachment_id).await;
        return result;
    }
    #[cfg(not(unix))]
    {
        let _ = (session_id, plan_item_id, plan_event_seq);
        Err(WorkflowCommandError::unavailable(
            "graph.run_set.open unavailable on this platform",
        ))
    }
}

/// Start one connection-scoped editable Loom authoring session. The returned
/// draft remains opaque editor data; only the daemon-issued revision is a
/// later authoring fence.
#[tauri::command(rename_all = "snake_case")]
pub async fn loom_author_draft(
    session_id: String,
    kind: LoomAuthorKind,
    prose: String,
) -> Result<LoomAuthorDraftResult, LoomCommandError> {
    #[cfg(unix)]
    {
        return loom_author_draft_response(
            loom_typed_request(
                RequestBody::LoomAuthorDraft {
                    session_id,
                    kind,
                    prose,
                },
                Capability::Control,
                &[FEATURE_LOOM_AUTHORING_V1],
            )
            .await?,
        );
    }
    #[cfg(not(unix))]
    {
        let _ = (session_id, kind, prose);
        Err(LoomCommandError::unavailable(
            "loom.author.draft unavailable on this platform",
        ))
    }
}

/// Re-parse an exact editor revision. The authoring fence is transmitted
/// verbatim and a stale value is returned as typed conflict data.
#[tauri::command(rename_all = "snake_case")]
pub async fn loom_author_revise(
    authoring_id: String,
    expected_revision: u64,
    kind: LoomAuthorKind,
    text: String,
) -> Result<LoomAuthorDraftResult, LoomCommandError> {
    #[cfg(unix)]
    {
        return loom_author_revise_response(
            loom_typed_request(
                loom_author_revise_request(authoring_id, expected_revision, kind, text),
                Capability::View,
                &[FEATURE_LOOM_AUTHORING_V1],
            )
            .await?,
        );
    }
    #[cfg(not(unix))]
    {
        let _ = (authoring_id, expected_revision, kind, text);
        Err(LoomCommandError::unavailable(
            "loom.author.revise unavailable on this platform",
        ))
    }
}

/// Confirm an exact authoring revision under the caller-observed registry
/// fence. `confirmed: None` is a complete validation outcome, not success.
#[allow(clippy::too_many_arguments)]
#[tauri::command(rename_all = "snake_case")]
pub async fn loom_author_confirm(
    authoring_id: String,
    expected_revision: u64,
    kind: LoomAuthorKind,
    text: String,
    expected_rev: Option<u32>,
    expected_digest: Option<String>,
) -> Result<LoomAuthorConfirmResult, LoomCommandError> {
    #[cfg(unix)]
    {
        return loom_author_confirm_response(
            loom_typed_request(
                RequestBody::LoomAuthorConfirm {
                    authoring_id,
                    expected_revision,
                    kind,
                    text,
                    expected_rev,
                    expected_digest,
                },
                Capability::Control,
                &[FEATURE_LOOM_AUTHORING_V1, FEATURE_LOOM_REGISTRY_CAS_V1],
            )
            .await?,
        );
    }
    #[cfg(not(unix))]
    {
        let _ = (
            authoring_id,
            expected_revision,
            kind,
            text,
            expected_rev,
            expected_digest,
        );
        Err(LoomCommandError::unavailable(
            "loom.author.confirm unavailable on this platform",
        ))
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn loom_validate(
    kind: LoomAuthorKind,
    text: String,
) -> Result<LoomValidateResult, LoomCommandError> {
    #[cfg(unix)]
    {
        return loom_validate_response(
            loom_typed_request(
                RequestBody::LoomValidate { kind, text },
                Capability::View,
                &[FEATURE_LOOM_VALIDATION_V1],
            )
            .await?,
        );
    }
    #[cfg(not(unix))]
    {
        let _ = (kind, text);
        Err(LoomCommandError::unavailable(
            "loom.validate unavailable on this platform",
        ))
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn loom_archive(
    kind: LoomRegistryEntryKind,
    id: String,
    expected_rev: u32,
    expected_digest: Option<String>,
) -> Result<LoomArchiveReceipt, LoomCommandError> {
    #[cfg(unix)]
    {
        return loom_archive_response(
            loom_typed_request(
                RequestBody::LoomArchive {
                    kind,
                    id,
                    expected_rev,
                    expected_digest,
                },
                Capability::Control,
                &[
                    FEATURE_LOOM_REGISTRY_ARCHIVE_V1,
                    FEATURE_LOOM_REGISTRY_CAS_V1,
                ],
            )
            .await?,
        );
    }
    #[cfg(not(unix))]
    {
        let _ = (kind, id, expected_rev, expected_digest);
        Err(LoomCommandError::unavailable(
            "loom.archive unavailable on this platform",
        ))
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn loom_unarchive(
    kind: LoomRegistryEntryKind,
    id: String,
    expected_rev: u32,
    expected_digest: Option<String>,
) -> Result<LoomArchiveReceipt, LoomCommandError> {
    #[cfg(unix)]
    {
        return loom_unarchive_response(
            loom_typed_request(
                RequestBody::LoomUnarchive {
                    kind,
                    id,
                    expected_rev,
                    expected_digest,
                },
                Capability::Control,
                &[
                    FEATURE_LOOM_REGISTRY_ARCHIVE_V1,
                    FEATURE_LOOM_REGISTRY_CAS_V1,
                ],
            )
            .await?,
        );
    }
    #[cfg(not(unix))]
    {
        let _ = (kind, id, expected_rev, expected_digest);
        Err(LoomCommandError::unavailable(
            "loom.unarchive unavailable on this platform",
        ))
    }
}

/// Install one archive-aware registry baseline plus its durable pushed tail.
/// JavaScript supplies and receives cursors only as exact decimal strings.
#[tauri::command(rename_all = "snake_case")]
pub async fn loom_watch(
    app: AppHandle,
    after_cursor: Option<String>,
) -> Result<LoomWatchResult, LoomCommandError> {
    let after_cursor = parse_loom_watch_after_cursor(after_cursor.as_deref())?;
    #[cfg(unix)]
    {
        let (reply, answer) = oneshot::channel();
        actor_handle()
            .commands
            .send(ActorCommand::LoomWatch {
                app,
                after_cursor,
                reply,
            })
            .map_err(|_| LoomCommandError::unavailable("loom.watch actor is unavailable"))?;
        return tokio::time::timeout(COMMAND_REPLY_TIMEOUT, answer)
            .await
            .map_err(|_| LoomCommandError::unavailable("loom.watch response timed out"))?
            .map_err(|_| LoomCommandError::unavailable("loom.watch connection closed"))?;
    }
    #[cfg(not(unix))]
    {
        let _ = (app, after_cursor);
        Err(LoomCommandError::unavailable(
            "loom.watch unavailable on this platform",
        ))
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn loom_register_workflow(
    source: String,
    expected_rev: Option<u32>,
    expected_digest: Option<String>,
) -> Result<LoomRegistrationReceipt, LoomCommandError> {
    #[cfg(unix)]
    {
        let response = loom_typed_request(
            RequestBody::LoomRegisterWorkflowCas {
                source,
                expected_rev,
                expected_digest,
            },
            Capability::Control,
            &[FEATURE_LOOM_V1, FEATURE_LOOM_REGISTRY_CAS_V1],
        )
        .await?;
        return loom_cas_registration_response(
            response,
            "loom.register_workflow response method mismatch",
        );
    }
    #[cfg(not(unix))]
    {
        let _ = (source, expected_rev, expected_digest);
        Err(LoomCommandError::unavailable(
            "loom.register_workflow unavailable on this platform",
        ))
    }
}

#[allow(clippy::too_many_arguments)]
#[tauri::command(rename_all = "snake_case")]
pub async fn loom_register_agent_type(
    id: String,
    name: String,
    job: String,
    in_type: String,
    out_type: String,
    clis: Vec<String>,
    apis: Vec<String>,
    skills: Vec<String>,
    scripts: Vec<String>,
    color: String,
    glyph: String,
    expected_rev: Option<u32>,
    expected_digest: Option<String>,
) -> Result<LoomRegistrationReceipt, LoomCommandError> {
    #[cfg(unix)]
    {
        let record = LoomAgentType {
            id,
            name,
            job,
            in_type,
            out_type,
            clis,
            apis,
            skills,
            scripts,
            color,
            glyph,
            // Registration input never controls the registry revision. The
            // 962 request wire carries zero and the daemon stores/returns the
            // authoritative positive revision in its receipt and list rows.
            rev: 0,
        };
        return loom_cas_registration_response(
            loom_typed_request(
                RequestBody::LoomRegisterAgentTypeCas {
                    record,
                    expected_rev,
                    expected_digest,
                },
                Capability::Control,
                &[FEATURE_LOOM_V1, FEATURE_LOOM_REGISTRY_CAS_V1],
            )
            .await?,
            "loom.register_agent_type response method mismatch",
        );
    }
    #[cfg(not(unix))]
    {
        let _ = (
            id,
            name,
            job,
            in_type,
            out_type,
            clis,
            apis,
            skills,
            scripts,
            color,
            glyph,
            expected_rev,
            expected_digest,
        );
        Err(LoomCommandError::unavailable(
            "loom.register_agent_type unavailable on this platform",
        ))
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn loom_install_status(agent_type_id: String) -> Result<TypedAgentInstallStatus, String> {
    #[cfg(unix)]
    {
        return loom_install_status_response(
            loom_request(
                "loom.install.status",
                RequestBody::LoomInstallStatus {
                    job_id: None,
                    agent_type_id: Some(agent_type_id),
                },
                Capability::View,
                FEATURE_TYPED_AGENT_INSTALL_V1,
            )
            .await?,
        );
    }
    #[cfg(not(unix))]
    {
        let _ = agent_type_id;
        Err("loom.install.status unavailable on this platform".to_string())
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn loom_install_retry(
    install_job_id: String,
) -> Result<TypedAgentInstallRetryReceipt, String> {
    #[cfg(unix)]
    {
        return loom_install_retry_response(
            loom_request(
                "loom.install.retry",
                RequestBody::LoomInstallRetry {
                    job_id: install_job_id,
                },
                Capability::Control,
                FEATURE_TYPED_AGENT_INSTALL_CONTROL_V1,
            )
            .await?,
        );
    }
    #[cfg(not(unix))]
    {
        let _ = install_job_id;
        Err("loom.install.retry unavailable on this platform".to_string())
    }
}

/// Cancel one exact durable install job. Future status variants are returned
/// as raw unknown outcomes rather than coerced into cancellation success.
#[tauri::command(rename_all = "snake_case")]
pub async fn loom_install_cancel(
    install_job_id: String,
) -> Result<TypedAgentInstallCancelReceipt, LoomCommandError> {
    #[cfg(unix)]
    {
        return loom_install_cancel_response(
            loom_typed_request(
                RequestBody::LoomInstallCancel { install_job_id },
                Capability::Control,
                &[FEATURE_TYPED_AGENT_INSTALL_CANCEL_V1],
            )
            .await?,
        );
    }
    #[cfg(not(unix))]
    {
        let _ = install_job_id;
        Err(LoomCommandError::unavailable(
            "loom.install.cancel unavailable on this platform",
        ))
    }
}

/// Poll one cursor-replayable install progress page. The returned cursor and
/// state names are daemon-issued and are carried without reinterpretation.
#[tauri::command(rename_all = "snake_case")]
pub async fn loom_install_watch(
    install_job_id: String,
    after_cursor: u64,
) -> Result<TypedAgentInstallWatchReceipt, String> {
    #[cfg(unix)]
    {
        return loom_install_watch_response(
            loom_request(
                "loom.install.watch",
                RequestBody::LoomInstallWatch {
                    job_id: install_job_id,
                    after_cursor,
                },
                Capability::View,
                FEATURE_TYPED_AGENT_INSTALL_CONTROL_V1,
            )
            .await?,
        );
    }
    #[cfg(not(unix))]
    {
        let _ = (install_job_id, after_cursor);
        Err("loom.install.watch unavailable on this platform".to_string())
    }
}

#[cfg(unix)]
async fn session_select_agent_type_inner(
    session_id: String,
    agent_type_id: String,
) -> Result<SessionAgentTypePersonaBindingReceipt, String> {
    let Some(summary) = config_session_summary(&session_id, Capability::Control).await? else {
        return Err("session.select_agent_type unavailable: no ADE connection".to_string());
    };
    let head_seq = config_u64(summary.get("head_seq"))
        .ok_or_else(|| "session summary head_seq was missing".to_string())?;
    let Some(response) = config_request(
        RequestBody::SessionAttach {
            session_id: session_id.clone(),
            after_seq: head_seq,
            mode: AttachMode::Control,
            sealed_replay: false,
        },
        Capability::Control,
        &[FEATURE_SESSION_AGENT_TYPE_SELECT_V1],
    )
    .await?
    else {
        return Err("session.select_agent_type unavailable: no ADE connection".to_string());
    };
    let ResponseBody::SessionAttach {
        attachment_id,
        attach_state,
    } = response
    else {
        return Err("session.attach response method mismatch".to_string());
    };
    if attach_state.session_id != session_id {
        let _ = config_request(
            RequestBody::SessionDetach { attachment_id },
            Capability::Control,
            &[],
        )
        .await;
        return Err("session.attach response session mismatch".to_string());
    }

    let selection = match config_request(
        RequestBody::SessionSelectAgentType {
            command_id: config_command_id("session-agent-type"),
            session_id: session_id.clone(),
            worker_generation: attach_state.worker_generation,
            agent_type: Some(agent_type_id),
        },
        Capability::Control,
        &[FEATURE_SESSION_AGENT_TYPE_SELECT_V1],
    )
    .await
    {
        Ok(Some(body)) => session_agent_type_persona_binding_response(body, &session_id),
        Ok(None) => Err("session.select_agent_type unavailable: no ADE connection".to_string()),
        Err(error) => Err(error),
    };

    let _ = config_request(
        RequestBody::SessionDetach { attachment_id },
        Capability::Control,
        &[],
    )
    .await;
    selection
}

/// Bind one registered type as this live session's persona. This is not an
/// install, readiness, capability, grant, or typed-executor command.
#[tauri::command(rename_all = "snake_case")]
pub async fn session_select_agent_type(
    session_id: String,
    agent_type_id: String,
) -> Result<SessionAgentTypePersonaBindingReceipt, String> {
    #[cfg(unix)]
    {
        let provider_session_id = tauri::async_runtime::spawn_blocking(move || {
            super::session_provider_session_id_blocking(&session_id)
        })
        .await
        .map_err(|error| format!("Session agent-type worker failed: {error}"))??;
        return session_select_agent_type_inner(provider_session_id, agent_type_id).await;
    }
    #[cfg(not(unix))]
    {
        let _ = (session_id, agent_type_id);
        Err("session.select_agent_type unavailable on this platform".to_string())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ApiKeyRetryDecision {
    Restage,
    Terminal,
}

fn public_error_code(error: &str) -> &str {
    error.split_once(':').map_or(error, |(code, _)| code)
}

fn add_api_key_retry_decision(error: &str, retries: usize) -> ApiKeyRetryDecision {
    if retries < MAX_ACCOUNT_RESTAGE_RETRIES
        && matches!(public_error_code(error), "restage_required" | "busy")
    {
        ApiKeyRetryDecision::Restage
    } else {
        ApiKeyRetryDecision::Terminal
    }
}

fn add_api_key_restage_command_id<'a>(
    command_id: &'a str,
    error: &str,
    retries: usize,
) -> Option<&'a str> {
    matches!(
        add_api_key_retry_decision(error, retries),
        ApiKeyRetryDecision::Restage
    )
    .then_some(command_id)
}

#[cfg(unix)]
async fn stage_api_key(secret: &SecretWire) -> Result<String, String> {
    let stage_id = account_stage_id();
    let response = account_request(
        RequestBody::VaultStage {
            stage_id: stage_id.clone(),
            purpose: StagePurpose::ApiKey,
            secret: secret.clone(),
        },
        Capability::Control,
        account_feature_gate(&[FEATURE_VAULT_STAGE_V1]),
    )
    .await?;
    match response {
        ResponseBody::VaultStage {
            stage_id: returned_stage_id,
            vault_reference,
            ..
        } if returned_stage_id == stage_id => Ok(vault_reference),
        ResponseBody::VaultStage { .. } => {
            Err("vault.stage response stage_id mismatch".to_string())
        }
        _ => Err("vault.stage response method mismatch".to_string()),
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn account_list(provider: Option<String>) -> Result<AccountListResult, String> {
    #[cfg(unix)]
    {
        return match rpc_request_with_feature_gate(
            RequestBody::AccountList { provider },
            Capability::View,
            account_feature_gate(&[FEATURE_ACCOUNT_MANAGEMENT_V1]),
            RpcErrorStyle::Public,
        )
        .await
        {
            Some(Ok(body)) => {
                account_list_response(body, actor_handle().account_roster_watch.borrow().clone())
            }
            Some(Err(error)) if error.starts_with("missing_feature:") => {
                Err(HAIDER_ACCOUNTS_UNAVAILABLE.to_string())
            }
            Some(Err(error)) => Err(error),
            None => Err(HAIDER_ACCOUNTS_UNAVAILABLE.to_string()),
        };
    }
    #[cfg(not(unix))]
    {
        let _ = provider;
        Err(HAIDER_ACCOUNTS_UNAVAILABLE.to_string())
    }
}

/// Reads the daemon-published provider/model inventory. An unavailable
/// subsystem remains a successful typed snapshot carrying its availability;
/// a missing feature is not rewritten into an empty inventory.
pub(crate) async fn provider_list_rpc(
    provider: Option<String>,
) -> Result<ProviderListResult, String> {
    #[cfg(unix)]
    {
        return match rpc_request_with_feature_gate(
            RequestBody::ProviderList { provider },
            Capability::View,
            FeatureGate::all(BTreeSet::from([FEATURE_PROVIDER_MANAGEMENT_V1.to_string()])),
            RpcErrorStyle::Public,
        )
        .await
        {
            Some(Ok(ResponseBody::ProviderList {
                providers,
                revision,
                availability,
            })) => Ok(ProviderListResult {
                providers,
                revision,
                availability,
            }),
            Some(Ok(_)) => Err("provider.list response method mismatch".to_string()),
            Some(Err(error)) => Err(error),
            None => Err("provider.list unavailable: no ADE connection".to_string()),
        };
    }
    #[cfg(not(unix))]
    {
        let _ = provider;
        Err("provider.list unavailable on this platform".to_string())
    }
}

/// Reads the cross-account usage snapshot. In particular, generated_at_ms=0
/// is retained as data; only the additive availability state can classify an
/// unavailable current daemon response.
pub(crate) async fn usage_report_rpc() -> Result<UsageReportResult, String> {
    #[cfg(unix)]
    {
        return match rpc_request_with_feature_gate(
            RequestBody::UsageReport {},
            Capability::View,
            FeatureGate::all(BTreeSet::from([FEATURE_USAGE_REPORT_V1.to_string()])),
            RpcErrorStyle::Public,
        )
        .await
        {
            Some(Ok(ResponseBody::UsageReport {
                report,
                availability,
            })) => Ok(UsageReportResult {
                report,
                availability,
            }),
            Some(Ok(_)) => Err("usage.report response method mismatch".to_string()),
            Some(Err(error)) => Err(error),
            None => Err("usage.report unavailable: no ADE connection".to_string()),
        };
    }
    #[cfg(not(unix))]
    Err("usage.report unavailable on this platform".to_string())
}

#[cfg(unix)]
fn usage_history_feature_gate() -> FeatureGate {
    FeatureGate::all(BTreeSet::from([FEATURE_USAGE_HISTORY_V1.to_string()]))
}

#[cfg(unix)]
fn usage_history_response(
    method: &str,
    response: Option<Result<ResponseBody, String>>,
) -> Result<Option<ResponseBody>, String> {
    match response {
        Some(Ok(response)) => Ok(Some(response)),
        Some(Err(error)) if error.starts_with("missing_feature:") => Ok(None),
        Some(Err(error)) => Err(format!("{method} failed: {error}")),
        None => Err(format!("{method} unavailable: no ADE connection")),
    }
}

#[cfg(unix)]
fn usage_history_day_from_rpc(
    requested_date: &str,
    response: Option<Result<ResponseBody, String>>,
) -> Result<UsageHistoryDayRead, String> {
    let Some(response) = usage_history_response("usage.history_day", response)? else {
        return Ok(UsageHistoryDayRead::Unsupported);
    };
    match response {
        ResponseBody::UsageHistoryDay {
            date,
            device_id,
            day,
            availability,
        } if date == requested_date => match day {
            Some(day) => Ok(UsageHistoryDayRead::Day {
                date,
                device_id,
                day,
                availability,
            }),
            None => Ok(UsageHistoryDayRead::NoDay {
                date,
                device_id,
                availability,
            }),
        },
        ResponseBody::UsageHistoryDay { date, .. } => Err(format!(
            "usage.history_day response date mismatch: requested {requested_date}, received {date}"
        )),
        _ => Err("usage.history_day response method mismatch".to_string()),
    }
}

/// Reads one device-local UTC ledger day. Feature absence is typed as
/// `Unsupported`; transport/protocol failures remain errors with their reason;
/// and `day: null` retains the daemon's device provenance in `NoDay`.
pub(crate) async fn usage_history_day_rpc(date: String) -> Result<UsageHistoryDayRead, String> {
    #[cfg(unix)]
    {
        let response = rpc_request_with_feature_gate(
            RequestBody::UsageHistoryDay { date: date.clone() },
            Capability::View,
            usage_history_feature_gate(),
            RpcErrorStyle::Public,
        )
        .await;
        return usage_history_day_from_rpc(&date, response);
    }
    #[cfg(not(unix))]
    {
        let _ = date;
        Ok(UsageHistoryDayRead::Unsupported)
    }
}

#[cfg(unix)]
fn usage_history_range_from_rpc(
    requested_through_date: &str,
    response: Option<Result<ResponseBody, String>>,
) -> Result<UsageHistoryRangeRead, String> {
    let Some(response) = usage_history_response("usage.history_range", response)? else {
        return Ok(UsageHistoryRangeRead::Unsupported);
    };
    match response {
        ResponseBody::UsageHistoryRange {
            through_date,
            device_id,
            days,
            availability,
        } if through_date == requested_through_date => Ok(UsageHistoryRangeRead::Range {
            through_date,
            device_id,
            days,
            availability,
        }),
        ResponseBody::UsageHistoryRange { through_date, .. } => Err(format!(
            "usage.history_range response date mismatch: requested {requested_through_date}, received {through_date}"
        )),
        _ => Err("usage.history_range response method mismatch".to_string()),
    }
}

/// Reads an absence-preserving bounded heatmap range without converting its
/// typed totals or availability into inferred booleans.
pub(crate) async fn usage_history_range_rpc(
    through_date: String,
    days: u16,
) -> Result<UsageHistoryRangeRead, String> {
    #[cfg(unix)]
    {
        let response = rpc_request_with_feature_gate(
            RequestBody::UsageHistoryRange {
                through_date: through_date.clone(),
                days,
            },
            Capability::View,
            usage_history_feature_gate(),
            RpcErrorStyle::Public,
        )
        .await;
        return usage_history_range_from_rpc(&through_date, response);
    }
    #[cfg(not(unix))]
    {
        let _ = (through_date, days);
        Ok(UsageHistoryRangeRead::Unsupported)
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn account_add_api_key(
    provider: String,
    alias: Option<String>,
    api_key: String,
    validation_model: Option<String>,
) -> Result<Value, String> {
    #[cfg(unix)]
    {
        let mut secret = SecretWire::new(api_key);
        let result = async {
            let command_id = account_command_id("account-login-api");
            let mut retries = 0;
            loop {
                let vault_reference = stage_api_key(&secret).await?;
                let response = account_request(
                    RequestBody::AccountLoginApi {
                        command_id: command_id.clone(),
                        provider: provider.clone(),
                        alias: alias.clone(),
                        vault_reference,
                        validation_model: validation_model.clone(),
                    },
                    Capability::Control,
                    account_feature_gate(&[FEATURE_VAULT_STAGE_V1, FEATURE_ACCOUNT_LOGIN_API_V1]),
                )
                .await;
                match response {
                    Ok(ResponseBody::AccountLoginApi { descriptor }) => return Ok(descriptor),
                    Ok(_) => return Err("account.login_api response method mismatch".to_string()),
                    Err(error) => {
                        if add_api_key_restage_command_id(&command_id, &error, retries).is_some() {
                            retries += 1;
                            tokio::time::sleep(ACCOUNT_RETRY_BACKOFF).await;
                        } else {
                            return Err(error);
                        }
                    }
                }
            }
        }
        .await;
        secret.wipe();
        return result;
    }
    #[cfg(not(unix))]
    {
        let _ = (provider, alias, validation_model);
        let mut secret = SecretWire::new(api_key);
        secret.wipe();
        Err(HAIDER_ACCOUNTS_UNAVAILABLE.to_string())
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn account_oauth_start(
    provider: String,
    desired_alias: String,
) -> Result<AccountOauthStartResult, String> {
    #[cfg(unix)]
    {
        let attempt_id = uuid::Uuid::new_v4().to_string();
        let response = account_request(
            RequestBody::AccountOauthStart {
                provider: provider.clone(),
                desired_alias,
                attempt_id: attempt_id.clone(),
            },
            Capability::Control,
            account_oauth_feature_gate(&provider),
        )
        .await?;
        return match response {
            ResponseBody::AccountOauthStart {
                availability,
                flow_id,
                authorization_url,
                user_code,
                provider_origin,
                loopback_port,
                expires_at_ms,
            } => Ok(AccountOauthStartResult {
                availability,
                flow_id,
                authorization_url,
                user_code,
                provider_origin,
                loopback_port,
                expires_at_ms,
                attempt_id,
            }),
            _ => Err("account.oauth_start response method mismatch".to_string()),
        };
    }
    #[cfg(not(unix))]
    {
        let _ = (provider, desired_alias);
        Err(HAIDER_ACCOUNTS_UNAVAILABLE.to_string())
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn account_oauth_status(
    flow_id: String,
    attempt_id: String,
) -> Result<AccountOauthFlowResult, String> {
    #[cfg(unix)]
    {
        let response = account_request(
            RequestBody::AccountOauthStatus {
                flow_id,
                attempt_id,
            },
            Capability::Control,
            account_oauth_flow_feature_gate(),
        )
        .await?;
        return match response {
            ResponseBody::AccountOauthStatus { flow_id, status } => {
                Ok(AccountOauthFlowResult { flow_id, status })
            }
            _ => Err("account.oauth_status response method mismatch".to_string()),
        };
    }
    #[cfg(not(unix))]
    {
        let _ = (flow_id, attempt_id);
        Err(HAIDER_ACCOUNTS_UNAVAILABLE.to_string())
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn account_oauth_cancel(
    flow_id: String,
    attempt_id: String,
) -> Result<AccountOauthFlowResult, String> {
    #[cfg(unix)]
    {
        let response = account_request(
            RequestBody::AccountOauthCancel {
                flow_id,
                attempt_id,
            },
            Capability::Control,
            account_oauth_flow_feature_gate(),
        )
        .await?;
        return match response {
            ResponseBody::AccountOauthCancel { flow_id, status } => {
                Ok(AccountOauthFlowResult { flow_id, status })
            }
            _ => Err("account.oauth_cancel response method mismatch".to_string()),
        };
    }
    #[cfg(not(unix))]
    {
        let _ = (flow_id, attempt_id);
        Err(HAIDER_ACCOUNTS_UNAVAILABLE.to_string())
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn account_oauth_add(
    provider: String,
    alias: String,
    flow_id: String,
    attempt_id: String,
    oauth_reference: String,
) -> Result<Value, String> {
    #[cfg(unix)]
    {
        let command_id = account_command_id("account-oauth-add");
        let mut retries = 0;
        loop {
            let response = account_request(
                RequestBody::AccountAdd {
                    command_id: command_id.clone(),
                    provider: provider.clone(),
                    alias: alias.clone(),
                    auth_method: AccountAddMethod::Oauth,
                    flow_id: flow_id.clone(),
                    attempt_id: attempt_id.clone(),
                    oauth_reference: oauth_reference.clone(),
                },
                Capability::Control,
                account_feature_gate(&[FEATURE_ACCOUNT_MANAGEMENT_V1]),
            )
            .await;
            match response {
                Ok(ResponseBody::AccountAdd { descriptor }) => return Ok(descriptor),
                Ok(_) => return Err("account.add response method mismatch".to_string()),
                Err(error)
                    if public_error_code(&error) == "busy"
                        && retries < MAX_ACCOUNT_RESTAGE_RETRIES =>
                {
                    retries += 1;
                    tokio::time::sleep(ACCOUNT_RETRY_BACKOFF).await;
                }
                Err(error) => return Err(error),
            }
        }
    }
    #[cfg(not(unix))]
    {
        let _ = (provider, alias, flow_id, attempt_id, oauth_reference);
        Err(HAIDER_ACCOUNTS_UNAVAILABLE.to_string())
    }
}

/// The daemon owns the import catalog (`account_oauth_import_sources_v1`).
/// Rows cross verbatim — source, provider, default_alias, available, and the
/// daemon's own unavailable_reason prose — because re-modelling them here is
/// how the hardcoded triple below drifted a whole source behind the harness.
///
/// `None` means this daemon does not publish a catalog, which is not the same
/// answer as a catalog that lists nothing; only the caller can decide what to
/// do about the first.
#[tauri::command(rename_all = "snake_case")]
pub async fn haider_account_oauth_import_sources() -> Result<Option<Vec<Value>>, String> {
    #[cfg(unix)]
    {
        match rpc_request_with_feature_gate(
            RequestBody::AccountOauthImportSources,
            Capability::View,
            account_feature_gate(&[FEATURE_ACCOUNT_OAUTH_IMPORT_SOURCES_V1]),
            RpcErrorStyle::Public,
        )
        .await
        {
            Some(Ok(ResponseBody::AccountOauthImportSources { sources })) => Ok(Some(sources)),
            Some(Ok(_)) => Err("account.oauth_import_sources response method mismatch".to_string()),
            Some(Err(error)) => Err(account_error(error)),
            None => Ok(None),
        }
    }
    #[cfg(not(unix))]
    {
        Ok(None)
    }
}

/// Sources this client shipped knowing about, used only against a daemon that
/// predates the published catalog. It is a floor for old daemons, never the
/// answer when the daemon has one — grok-cli existed here for a release while
/// this list said it did not.
const HAIDER_LEGACY_IMPORT_SOURCES: &[&str] = &["codex", "claude-code", "kimi-code"];

/// A published catalog is the whole answer: every source in it is importable
/// and nothing outside it is. The shipped list applies only where no catalog
/// was published at all.
fn haider_import_source_is_known(published: Option<&[Value]>, source: &str) -> bool {
    match published {
        Some(sources) => sources
            .iter()
            .any(|entry| entry.get("source").and_then(Value::as_str) == Some(source)),
        None => HAIDER_LEGACY_IMPORT_SOURCES.contains(&source),
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn haider_account_oauth_import(source: String) -> Result<AccountImportResult, String> {
    let published = haider_account_oauth_import_sources().await.unwrap_or(None);
    if !haider_import_source_is_known(published.as_deref(), source.as_str()) {
        return Err("invalid_argument".to_string());
    }
    #[cfg(unix)]
    {
        let response = account_request(
            RequestBody::AccountOauthImport {
                command_id: account_command_id("account-oauth-import"),
                source,
            },
            Capability::Control,
            account_feature_gate(&[FEATURE_ACCOUNT_OAUTH_IMPORT_V1]),
        )
        .await?;
        return match response {
            ResponseBody::AccountOauthImport {
                descriptor,
                revision,
            } => Ok(AccountImportResult {
                descriptor,
                revision,
            }),
            _ => Err("account.oauth_import response method mismatch".to_string()),
        };
    }
    #[cfg(not(unix))]
    {
        let _ = source;
        Err(HAIDER_ACCOUNTS_UNAVAILABLE.to_string())
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn haider_account_device_candidates() -> Result<AccountDeviceCandidatesResult, String> {
    #[cfg(unix)]
    {
        let response = account_request(
            RequestBody::AccountDeviceCandidates {},
            Capability::View,
            account_feature_gate(&[FEATURE_ACCOUNT_DEVICE_DISCOVERY_V1]),
        )
        .await?;
        return match response {
            ResponseBody::AccountDeviceCandidates {
                discovery_disabled,
                candidates,
            } => Ok(AccountDeviceCandidatesResult {
                discovery_disabled,
                candidates,
            }),
            _ => Err("account.device_candidates response method mismatch".to_string()),
        };
    }
    #[cfg(not(unix))]
    {
        Err(HAIDER_ACCOUNTS_UNAVAILABLE.to_string())
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn haider_account_import_device(
    candidate: String,
) -> Result<AccountImportResult, String> {
    #[cfg(unix)]
    {
        let response = account_request(
            RequestBody::AccountImportDevice {
                command_id: account_command_id("account-import-device"),
                candidate,
            },
            Capability::Control,
            account_feature_gate(&[FEATURE_ACCOUNT_DEVICE_DISCOVERY_V1]),
        )
        .await?;
        return match response {
            ResponseBody::AccountImportDevice {
                descriptor,
                revision,
            } => Ok(AccountImportResult {
                descriptor,
                revision,
            }),
            _ => Err("account.import_device response method mismatch".to_string()),
        };
    }
    #[cfg(not(unix))]
    {
        let _ = candidate;
        Err(HAIDER_ACCOUNTS_UNAVAILABLE.to_string())
    }
}

/// Sets or clears an operator-chosen display label for an account. Plain
/// management class: Control, no UDS, and deliberately NO command_id — a
/// label is idempotent by value, so a receipt would be ceremony without
/// safety and a retry is naturally safe.
///
/// The daemon TRUNCATES an over-long label rather than rejecting it, so the
/// returned descriptor is the truth and callers reconcile from it.
#[tauri::command(rename_all = "snake_case")]
pub async fn account_set_label(
    alias: String,
    label: Option<String>,
) -> Result<AccountSetLabelResult, String> {
    #[cfg(unix)]
    {
        /* Empty-after-trim clears, matching the daemon: the UI's "erase the
        label" gesture and an explicit clear are the same intent. */
        let label = label
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let response = account_request(
            RequestBody::AccountSetLabel { alias, label },
            Capability::Control,
            account_feature_gate(&[FEATURE_ACCOUNT_MANAGEMENT_V1]),
        )
        .await?;
        return match response {
            ResponseBody::AccountSetLabel {
                descriptor,
                revision,
            } => Ok(AccountSetLabelResult {
                descriptor,
                revision,
            }),
            _ => Err("account.set_label response method mismatch".to_string()),
        };
    }
    #[cfg(not(unix))]
    {
        let _ = (alias, label);
        Err(HAIDER_ACCOUNTS_UNAVAILABLE.to_string())
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn account_set_active(
    alias: String,
    confirm_new_epoch: bool,
) -> Result<AccountSetActiveResult, String> {
    #[cfg(unix)]
    {
        let response = account_request(
            RequestBody::AccountSetActive {
                command_id: account_command_id("account-set-active"),
                alias,
                confirm_new_epoch,
            },
            Capability::Control,
            account_feature_gate(&[FEATURE_ACCOUNT_MANAGEMENT_V1]),
        )
        .await?;
        return match response {
            ResponseBody::AccountSetActive {
                descriptor,
                prior_alias,
                revision,
            } => Ok(AccountSetActiveResult {
                descriptor,
                prior_alias,
                revision,
            }),
            _ => Err("account.set_active response method mismatch".to_string()),
        };
    }
    #[cfg(not(unix))]
    {
        let _ = (alias, confirm_new_epoch);
        Err(HAIDER_ACCOUNTS_UNAVAILABLE.to_string())
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn account_remove(
    alias: String,
    expected_revision: Option<u64>,
) -> Result<AccountRemoveResult, String> {
    #[cfg(unix)]
    {
        let response = account_request(
            RequestBody::AccountRemove {
                command_id: account_command_id("account-remove"),
                alias,
                expected_revision,
            },
            Capability::Control,
            account_feature_gate(&[FEATURE_ACCOUNT_MANAGEMENT_V1]),
        )
        .await?;
        return match response {
            ResponseBody::AccountRemove {
                removed_alias,
                replacement_active_alias,
                revision,
            } => Ok(AccountRemoveResult {
                removed_alias,
                replacement_active_alias,
                revision,
            }),
            _ => Err("account.remove response method mismatch".to_string()),
        };
    }
    #[cfg(not(unix))]
    {
        let _ = (alias, expected_revision);
        Err(HAIDER_ACCOUNTS_UNAVAILABLE.to_string())
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn account_set_default_model(
    provider: String,
    model: String,
    expected_revision: u64,
) -> Result<AccountSetDefaultModelResult, String> {
    #[cfg(unix)]
    {
        let response = account_request(
            RequestBody::AccountSetDefaultModel {
                command_id: account_command_id("account-set-default-model"),
                provider,
                model,
                expected_revision,
            },
            Capability::Control,
            account_feature_gate(&[FEATURE_ACCOUNT_MANAGEMENT_V1]),
        )
        .await?;
        return match response {
            ResponseBody::AccountSetDefaultModel {
                provider_summary,
                revision,
            } => Ok(AccountSetDefaultModelResult {
                provider_summary,
                revision,
            }),
            _ => Err("account.set_default_model response method mismatch".to_string()),
        };
    }
    #[cfg(not(unix))]
    {
        let _ = (provider, model, expected_revision);
        Err(HAIDER_ACCOUNTS_UNAVAILABLE.to_string())
    }
}

#[cfg(unix)]
async fn upload_staged_paste_attachments(
    paths: Vec<String>,
) -> Result<Vec<SurfaceAttachmentWire>, String> {
    let mut attachments = Vec::with_capacity(paths.len());
    for path in paths {
        attachments.push(upload_staged_paste_attachment(path).await?);
    }
    Ok(attachments)
}

#[cfg(unix)]
fn attachment_upload_or_text_only(
    upload: Result<Vec<SurfaceAttachmentWire>, String>,
) -> Vec<SurfaceAttachmentWire> {
    match upload {
        Ok(attachments) => attachments,
        Err(error) => {
            // The input mirror is volatile and the frontend does not await
            // this command. Preserve the text mirror when attachment upload
            // fails rather than silently dropping the whole publish.
            eprintln!("Could not upload staged paste attachment; publishing text only: {error}");
            Vec::new()
        }
    }
}

#[cfg(unix)]
async fn upload_staged_paste_attachment(path: String) -> Result<SurfaceAttachmentWire, String> {
    let (bytes, mime) =
        tauri::async_runtime::spawn_blocking(move || read_staged_paste_attachment(&path))
            .await
            .map_err(|error| format!("Staged paste attachment worker failed: {error}"))??;
    let expected_bytes = u64::try_from(bytes.len())
        .map_err(|_| "Staged paste attachment is too large to publish.".to_string())?;
    let data_base64 = {
        use base64::Engine as _;
        base64::engine::general_purpose::STANDARD.encode(bytes)
    };
    let response = rpc_request(
        RequestBody::ArtifactPut { data_base64 },
        Capability::Control,
        BTreeSet::from([FEATURE_ARTIFACT_PUT_V1.to_string()]),
    )
    .await
    .ok_or_else(|| {
        "Haider RPC connection closed while uploading composer attachment.".to_string()
    })??;
    let ResponseBody::ArtifactPut { artifact, bytes } = response else {
        return Err("artifact.put response method mismatch".to_string());
    };
    if bytes != expected_bytes {
        return Err("artifact.put response byte count mismatch".to_string());
    }
    Ok(SurfaceAttachmentWire {
        mime,
        bytes,
        artifact,
    })
}

#[cfg(unix)]
fn read_staged_paste_attachment(path: &str) -> Result<(Vec<u8>, String), String> {
    use std::{
        ffi::CString,
        fs::File,
        io::Read,
        os::unix::{
            ffi::OsStrExt as _,
            fs::MetadataExt as _,
            io::{AsRawFd as _, FromRawFd as _},
        },
    };

    let candidate = Path::new(path);
    let staged_name = candidate
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| name.starts_with("diffforge-paste-"))
        .ok_or_else(|| "Path is not a staged paste attachment.".to_string())?;
    let temp_root = std::env::temp_dir()
        .canonicalize()
        .map_err(|error| format!("Could not resolve temporary directory: {error}"))?;
    let candidate_parent = candidate
        .parent()
        .ok_or_else(|| "Path is not a staged paste attachment.".to_string())?;
    let canonical_parent = candidate_parent
        .canonicalize()
        .map_err(|error| format!("Staged paste attachment is unavailable: {error}"))?;
    if canonical_parent != temp_root {
        return Err("Path is not a staged paste attachment.".to_string());
    }

    // Keep the parent directory and staged file bound to file descriptors:
    // another process may replace either pathname after the ownership check.
    // `openat` pins the child to the checked parent and `O_NOFOLLOW` refuses a
    // swapped-in symlink, so the bytes below come from the validated handle.
    let temp_root_dir = File::open(&temp_root)
        .map_err(|error| format!("Could not open temporary directory: {error}"))?;
    let candidate_parent_dir = File::open(candidate_parent)
        .map_err(|error| format!("Staged paste attachment is unavailable: {error}"))?;
    let temp_root_metadata = temp_root_dir
        .metadata()
        .map_err(|error| format!("Could not inspect temporary directory: {error}"))?;
    let candidate_parent_metadata = candidate_parent_dir
        .metadata()
        .map_err(|error| format!("Could not inspect staged paste directory: {error}"))?;
    if candidate_parent_metadata.dev() != temp_root_metadata.dev()
        || candidate_parent_metadata.ino() != temp_root_metadata.ino()
    {
        return Err("Path is not a staged paste attachment.".to_string());
    }

    let name = CString::new(staged_name)
        .map_err(|_| "Path is not a staged paste attachment.".to_string())?;
    let fd = unsafe {
        libc::openat(
            candidate_parent_dir.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
        )
    };
    if fd < 0 {
        return Err(format!(
            "Staged paste attachment is unavailable: {}",
            std::io::Error::last_os_error()
        ));
    }
    let mut file = unsafe { File::from_raw_fd(fd) };
    let metadata = file
        .metadata()
        .map_err(|error| format!("Could not inspect staged paste attachment: {error}"))?;
    if !metadata.is_file() {
        return Err("Path is not a staged paste attachment.".to_string());
    }

    let mime = match Path::new(staged_name)
        .extension()
        .and_then(|extension| extension.to_str())
    {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        _ => return Err("Staged paste attachment has an unsupported image type.".to_string()),
    };
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|error| format!("Could not read staged paste attachment: {error}"))?;
    Ok((bytes, mime.to_string()))
}

#[cfg(unix)]
fn attachments_for_current_connection(
    connection: &ConnectionSnapshot,
    attachments: Vec<SurfaceAttachmentWire>,
) -> Vec<SurfaceAttachmentWire> {
    connection
        .can_publish_input_attachments()
        .then_some(attachments)
        .unwrap_or_default()
}

#[cfg(unix)]
fn config_features(extra: &[&str]) -> BTreeSet<String> {
    [FEATURE_SESSION_CONFIG_V1, FEATURE_SESSION_OBSERVE_V1]
        .into_iter()
        .chain(extra.iter().copied())
        .map(str::to_string)
        .collect()
}

#[cfg(unix)]
async fn config_request(
    body: RequestBody,
    capability: Capability,
    extra_features: &[&str],
) -> Result<Option<ResponseBody>, String> {
    match rpc_request(body, capability, config_features(extra_features)).await {
        Some(Ok(response)) => Ok(Some(response)),
        Some(Err(error)) => Err(error),
        None => Ok(None),
    }
}

#[cfg(unix)]
fn resident_turn_submit_features(explicit_mode: bool) -> BTreeSet<String> {
    let mut features = BTreeSet::from([FEATURE_RESIDENT_TURN_SUBMIT_V1.to_string()]);
    if explicit_mode {
        features.insert(FEATURE_QUEUE_CONTROL_V1.to_string());
    }
    features
}

#[cfg(unix)]
async fn resident_turn_submit_request(
    body: RequestBody,
    explicit_mode: bool,
) -> Result<Option<ResponseBody>, String> {
    match rpc_request(
        body,
        Capability::Control,
        resident_turn_submit_features(explicit_mode),
    )
    .await
    {
        Some(Ok(response)) => Ok(Some(response)),
        Some(Err(error)) => Err(error),
        None => Ok(None),
    }
}

#[cfg(unix)]
fn session_seen_features() -> BTreeSet<String> {
    BTreeSet::from([FEATURE_SESSION_SEEN_V1.to_string()])
}

#[cfg(unix)]
async fn session_seen_request(body: RequestBody) -> Result<Option<ResponseBody>, String> {
    match rpc_request(body, Capability::Control, session_seen_features()).await {
        Some(Ok(response)) => Ok(Some(response)),
        Some(Err(error)) => Err(error),
        None => Ok(None),
    }
}

#[cfg(unix)]
fn session_needs_input_features() -> BTreeSet<String> {
    BTreeSet::from([FEATURE_SESSION_NEEDS_INPUT_V1.to_string()])
}

#[cfg(unix)]
async fn session_needs_input_request(body: RequestBody) -> Result<Option<ResponseBody>, String> {
    match rpc_request_with_feature_gate(
        body,
        Capability::Control,
        FeatureGate::all(session_needs_input_features()),
        RpcErrorStyle::Public,
    )
    .await
    {
        Some(Ok(response)) => Ok(Some(response)),
        Some(Err(error)) => Err(error),
        None => Ok(None),
    }
}

#[cfg(unix)]
async fn config_session_summary(
    session_id: &str,
    capability: Capability,
) -> Result<Option<Value>, String> {
    let mut cursor = None;
    loop {
        let Some(response) = config_request(
            RequestBody::SessionList { cursor, limit: 256 },
            capability,
            &[],
        )
        .await?
        else {
            return Ok(None);
        };
        let ResponseBody::SessionList {
            sessions,
            next_cursor,
        } = response
        else {
            return Err("session.list response method mismatch".to_string());
        };
        if let Some(summary) = sessions
            .into_iter()
            .find(|summary| summary.get("session_id").and_then(Value::as_str) == Some(session_id))
        {
            return Ok(Some(summary));
        }
        let Some(next_cursor) = next_cursor else {
            return Err(format!("session `{session_id}` was not found"));
        };
        cursor = Some(next_cursor);
    }
}

#[cfg(unix)]
async fn resident_turn_submit_session_summary(
    session_id: &str,
    explicit_mode: bool,
) -> Result<Option<Value>, String> {
    let mut cursor = None;
    loop {
        let Some(response) = resident_turn_submit_request(
            RequestBody::SessionList { cursor, limit: 256 },
            explicit_mode,
        )
        .await?
        else {
            return Ok(None);
        };
        let ResponseBody::SessionList {
            sessions,
            next_cursor,
        } = response
        else {
            return Err("session.list response method mismatch".to_string());
        };
        if let Some(summary) = sessions
            .into_iter()
            .find(|summary| summary.get("session_id").and_then(Value::as_str) == Some(session_id))
        {
            return Ok(Some(summary));
        }
        let Some(next_cursor) = next_cursor else {
            return Err(format!("session `{session_id}` was not found"));
        };
        cursor = Some(next_cursor);
    }
}

#[cfg(unix)]
async fn session_seen_session_summary(session_id: &str) -> Result<Option<Value>, String> {
    let mut cursor = None;
    loop {
        let Some(response) =
            session_seen_request(RequestBody::SessionList { cursor, limit: 256 }).await?
        else {
            return Ok(None);
        };
        let ResponseBody::SessionList {
            sessions,
            next_cursor,
        } = response
        else {
            return Err("session.list response method mismatch".to_string());
        };
        if let Some(summary) = sessions
            .into_iter()
            .find(|summary| summary.get("session_id").and_then(Value::as_str) == Some(session_id))
        {
            return Ok(Some(summary));
        }
        let Some(next_cursor) = next_cursor else {
            return Err(format!("session `{session_id}` was not found"));
        };
        cursor = Some(next_cursor);
    }
}

#[cfg(unix)]
async fn session_needs_input_summary(session_id: &str) -> Result<Option<Value>, String> {
    let mut cursor = None;
    loop {
        let Some(response) =
            session_needs_input_request(RequestBody::SessionList { cursor, limit: 256 }).await?
        else {
            return Ok(None);
        };
        let ResponseBody::SessionList {
            sessions,
            next_cursor,
        } = response
        else {
            return Err("session.list response method mismatch".to_string());
        };
        if let Some(summary) = sessions
            .into_iter()
            .find(|summary| summary.get("session_id").and_then(Value::as_str) == Some(session_id))
        {
            return Ok(Some(summary));
        }
        let Some(next_cursor) = next_cursor else {
            return Err(format!("session `{session_id}` was not found"));
        };
        cursor = Some(next_cursor);
    }
}

#[cfg(unix)]
fn config_provider_feature_gate() -> [&'static str; 2] {
    [FEATURE_PROVIDER_MANAGEMENT_V1, FEATURE_PROVIDER_MODELS_V1]
}

#[cfg(unix)]
async fn config_providers(capability: Capability) -> Result<Option<Vec<Value>>, String> {
    let Some(response) = config_request(
        RequestBody::ProviderList { provider: None },
        capability,
        &config_provider_feature_gate(),
    )
    .await?
    else {
        return Ok(None);
    };
    match response {
        ResponseBody::ProviderList {
            providers,
            availability,
            ..
        } => match availability {
            Some(SnapshotAvailabilityWire::Unavailable { reason }) => Err(format!(
                "provider.list unavailable while reading session config: {reason}"
            )),
            Some(SnapshotAvailabilityWire::Unknown) => Err(
                "provider.list availability is unknown while reading session config".to_string(),
            ),
            _ => Ok(Some(providers)),
        },
        _ => Err("provider.list response method mismatch".to_string()),
    }
}

#[cfg(unix)]
fn config_u64(value: Option<&Value>) -> Option<u64> {
    value.and_then(|value| {
        value
            .as_u64()
            .or_else(|| value.as_i64().and_then(|value| u64::try_from(value).ok()))
    })
}

#[cfg(unix)]
fn config_document(summary: &Value, providers: &[Value], digest: Value) -> Result<Value, String> {
    let digest = digest
        .as_object()
        .ok_or_else(|| "session.observe digest was invalid".to_string())?;
    let subagents = match digest.get("subagents") {
        Some(subagents @ Value::Array(_)) => subagents.clone(),
        Some(_) => return Err("session.observe subagents was invalid".to_string()),
        None => Value::Null,
    };
    let metadata = digest
        .get("metadata")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            "session has no typed configuration metadata; it may have been created by an older daemon"
                .to_string()
        })?;
    let provider = metadata
        .get("provider")
        .and_then(Value::as_str)
        .ok_or_else(|| "session config provider was missing".to_string())?;
    let model = metadata
        .get("model")
        .and_then(Value::as_str)
        .ok_or_else(|| "session config model was missing".to_string())?;
    let context_window = providers
        .iter()
        .find(|candidate| candidate.get("provider").and_then(Value::as_str) == Some(provider))
        .and_then(|candidate| candidate.get("model_details"))
        .and_then(Value::as_array)
        .and_then(|details| {
            details
                .iter()
                .find(|detail| detail.get("name").and_then(Value::as_str) == Some(model))
        })
        .and_then(|detail| config_u64(detail.get("context_window")));
    let footprint = digest
        .get("latest_context_footprint")
        .and_then(Value::as_object)
        .and_then(|footprint| {
            Some(serde_json::json!({
                "truth": footprint.get("truth")?.clone(),
                "tokens": config_u64(footprint.get("used_tokens"))?,
            }))
        })
        .unwrap_or(Value::Null);
    let fast = metadata.get("fast").and_then(Value::as_bool);
    let speed = fast.map(|fast| if fast { "fast" } else { "normal" });
    let summary = summary.as_object();

    Ok(serde_json::json!({
        "schema": "haider.session_config.v1",
        "session_id": digest.get("session_id").cloned().unwrap_or(Value::Null),
        "title": digest.get("title").cloned().unwrap_or(Value::Null),
        "run_state": digest.get("run_state").cloned().unwrap_or(Value::Null),
        "provider": provider,
        "model": model,
        "effort": metadata.get("effort").cloned().unwrap_or(Value::Null),
        "speed": speed,
        "fast": fast,
        "account_alias": Value::Null,
        "agent_type": metadata.get("agent_type").cloned().unwrap_or(Value::Null),
        "context_window": context_window,
        "workspace_cwd": metadata.get("cwd").cloned().unwrap_or(Value::Null),
        "max_tokens": metadata.get("max_tokens").cloned().unwrap_or(Value::Null),
        "created_at_ms": metadata.get("created_at_ms").cloned().unwrap_or(Value::Null),
        "head_seq": digest.get("head_seq").cloned().unwrap_or(Value::Null),
        "worker_generation": digest.get("worker_generation").cloned().unwrap_or(Value::Null),
        "turn_count": summary.and_then(|summary| summary.get("turn_count")).cloned().unwrap_or(Value::Null),
        "footprint": footprint,
        // The observe digest is the authority for both identity and state.
        // An omitted field is legacy/unknown, which is distinct from a
        // present empty array and must not be collapsed into a zero count.
        "subagents": subagents,
        "agent_metrics": summary.and_then(|summary| summary.get("agent_metrics")).cloned().unwrap_or(Value::Null),
        "updated_at_ms": digest.get("updated_at_ms").cloned().unwrap_or(Value::Null),
    }))
}

#[cfg(unix)]
async fn session_config_get_rpc_inner(session_id: String) -> Result<Option<Value>, String> {
    let Some(summary) = config_session_summary(&session_id, Capability::View).await? else {
        return Ok(None);
    };
    let Some(providers) = config_providers(Capability::View).await? else {
        return Ok(None);
    };
    let Some(response) = config_request(
        RequestBody::SessionObserve {
            session_id,
            last_event_limit: 0,
            metadata_only: false,
        },
        Capability::View,
        &[],
    )
    .await?
    else {
        return Ok(None);
    };
    match response {
        ResponseBody::SessionObserve { digest } => {
            config_document(&summary, &providers, digest).map(Some)
        }
        _ => Err("session.observe response method mismatch".to_string()),
    }
}

pub(crate) async fn session_config_get_rpc(session_id: String) -> Option<Result<Value, String>> {
    #[cfg(unix)]
    {
        return match session_config_get_rpc_inner(session_id).await {
            Ok(Some(value)) => Some(Ok(value)),
            Ok(None) => None,
            Err(error) => Some(Err(error)),
        };
    }
    #[cfg(not(unix))]
    {
        let _ = session_id;
        None
    }
}

#[cfg(unix)]
fn config_model_selector(
    selector: &str,
    providers: &[Value],
) -> Result<(Option<String>, String), String> {
    if let Some((provider, model)) = selector.split_once('/') {
        if providers
            .iter()
            .any(|candidate| candidate.get("provider").and_then(Value::as_str) == Some(provider))
        {
            if model.is_empty() {
                return Err("provider/model selector has an empty model".to_string());
            }
            return Ok((Some(provider.to_string()), model.to_string()));
        }
    }
    Ok((None, selector.to_string()))
}

#[cfg(unix)]
fn config_command_id(label: &str) -> String {
    format!("diffforge-{label}-{}", uuid::Uuid::new_v4())
}

#[cfg(unix)]
async fn session_config_set_rpc_inner(
    session_id: String,
    model: Option<String>,
    effort: Option<String>,
    speed: Option<String>,
    account: Option<String>,
) -> Result<Option<Value>, String> {
    let Some(summary) = config_session_summary(&session_id, Capability::Control).await? else {
        return Ok(None);
    };
    let Some(providers) = config_providers(Capability::Control).await? else {
        return Ok(None);
    };
    if account.is_some() {
        return Err(format!(
            "missing_feature: daemon does not advertise {FEATURE_SESSION_ACCOUNT_SELECT_V1}"
        ));
    }
    let fast = match speed.as_deref() {
        Some("fast") => Some(true),
        Some("normal") => Some(false),
        Some(_) => return Err("Haider speed must be `fast` or `normal`.".to_string()),
        None => None,
    };
    let head_seq = config_u64(summary.get("head_seq"))
        .ok_or_else(|| "session summary head_seq was missing".to_string())?;
    let Some(response) = config_request(
        RequestBody::SessionAttach {
            session_id: session_id.clone(),
            after_seq: head_seq,
            mode: AttachMode::Control,
            sealed_replay: false,
        },
        Capability::Control,
        &[],
    )
    .await?
    else {
        return Ok(None);
    };
    let ResponseBody::SessionAttach {
        attachment_id,
        attach_state,
    } = response
    else {
        return Err("session.attach response method mismatch".to_string());
    };
    if attach_state.session_id != session_id {
        let _ = config_request(
            RequestBody::SessionDetach { attachment_id },
            Capability::Control,
            &[],
        )
        .await;
        return Err("session.attach response session mismatch".to_string());
    }
    let mut worker_generation = attach_state.worker_generation;

    let mutation = async {
        if let Some(selector) = model.as_deref() {
            let (provider, model) = config_model_selector(selector, &providers)?;
            let Some(response) = config_request(
                RequestBody::SessionSelectModel {
                    command_id: config_command_id("session-config-model"),
                    session_id: session_id.clone(),
                    worker_generation,
                    model,
                    provider,
                    confirm_new_epoch: false,
                },
                Capability::Control,
                &[FEATURE_SESSION_MODEL_SELECT_V1],
            )
            .await?
            else {
                return Err("Haider RPC disconnected during session config update".to_string());
            };
            match response {
                ResponseBody::SessionSelectModel {
                    session_id: selected_session,
                    worker_generation: selected_generation,
                    ..
                } if selected_session == session_id => worker_generation = selected_generation,
                _ => return Err("session.select_model response method mismatch".to_string()),
            }
        }
        if let Some(effort) = effort {
            let Some(response) = config_request(
                RequestBody::SessionSelectEffort {
                    command_id: config_command_id("session-config-effort"),
                    session_id: session_id.clone(),
                    worker_generation,
                    effort: Some(effort),
                    confirm_new_epoch: false,
                },
                Capability::Control,
                &[FEATURE_SESSION_EFFORT_SELECT_V1],
            )
            .await?
            else {
                return Err("Haider RPC disconnected during session config update".to_string());
            };
            match response {
                ResponseBody::SessionSelectEffort {
                    session_id: selected_session,
                    worker_generation: selected_generation,
                    ..
                } if selected_session == session_id => worker_generation = selected_generation,
                _ => return Err("session.select_effort response method mismatch".to_string()),
            }
        }
        if let Some(enabled) = fast {
            let Some(response) = config_request(
                RequestBody::SessionSelectFast {
                    command_id: config_command_id("session-config-speed"),
                    session_id: session_id.clone(),
                    worker_generation,
                    enabled,
                    confirm_new_epoch: false,
                },
                Capability::Control,
                &[FEATURE_SESSION_FAST_SELECT_V1],
            )
            .await?
            else {
                return Err("Haider RPC disconnected during session config update".to_string());
            };
            match response {
                ResponseBody::SessionSelectFast {
                    session_id: selected_session,
                    ..
                } if selected_session == session_id => {}
                _ => return Err("session.select_fast response method mismatch".to_string()),
            }
        }
        Ok(())
    }
    .await;

    let _ = config_request(
        RequestBody::SessionDetach { attachment_id },
        Capability::Control,
        &[],
    )
    .await;
    mutation?;
    Ok(Some(serde_json::json!({"ok": true})))
}

pub(crate) async fn session_config_set_rpc(
    session_id: String,
    model: Option<String>,
    effort: Option<String>,
    speed: Option<String>,
    account: Option<String>,
) -> Option<Result<Value, String>> {
    #[cfg(unix)]
    {
        return match session_config_set_rpc_inner(session_id, model, effort, speed, account).await {
            Ok(Some(value)) => Some(Ok(value)),
            Ok(None) => None,
            Err(error) => Some(Err(error)),
        };
    }
    #[cfg(not(unix))]
    {
        let _ = (session_id, model, effort, speed, account);
        None
    }
}

#[cfg(unix)]
fn resident_turn_submit_command_id() -> String {
    format!("diffforge-resident-turn-{}", uuid::Uuid::new_v4())
}

#[cfg(unix)]
fn session_seen_command_id() -> String {
    format!("diffforge-session-seen-{}", uuid::Uuid::new_v4())
}

#[cfg(unix)]
fn session_seen_available(connection: &ConnectionSnapshot) -> bool {
    connection.connected && connection.features.contains(FEATURE_SESSION_SEEN_V1)
}

#[cfg(unix)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionNeedsInputReachability {
    NoConnection,
    FeatureMissing,
    Ready,
}

#[cfg(unix)]
fn session_needs_input_reachability(
    connection: &ConnectionSnapshot,
) -> SessionNeedsInputReachability {
    if !connection.connected {
        SessionNeedsInputReachability::NoConnection
    } else if !connection.features.contains(FEATURE_SESSION_NEEDS_INPUT_V1) {
        SessionNeedsInputReachability::FeatureMissing
    } else {
        SessionNeedsInputReachability::Ready
    }
}

#[cfg(unix)]
fn session_needs_input_available(connection: &ConnectionSnapshot) -> bool {
    session_needs_input_reachability(connection) == SessionNeedsInputReachability::Ready
}

#[cfg(unix)]
fn nudge_rpc_reconnect() {
    let _ = actor_handle().commands.send(ActorCommand::ReconnectNow);
}

#[cfg(unix)]
fn session_answer_menu_prepare<T>(
    context: Result<T, String>,
    reachability: SessionNeedsInputReachability,
    reconnect: impl FnOnce(),
) -> Result<T, String> {
    // Fence/context failure wins even while offline. This ordering is part of
    // the public contract: reachability must never disguise a stale card.
    let context = context?;
    match reachability {
        SessionNeedsInputReachability::NoConnection => {
            reconnect();
            Err(HAIDER_NEEDS_INPUT_NO_CONNECTION.to_string())
        }
        SessionNeedsInputReachability::FeatureMissing => {
            Err(HAIDER_NEEDS_INPUT_FEATURE_MISSING.to_string())
        }
        SessionNeedsInputReachability::Ready => Ok(context),
    }
}

#[cfg(unix)]
fn session_answer_menu_pre_answer_error(
    initial_reachability: SessionNeedsInputReachability,
    detail: Option<&str>,
) -> String {
    if detail.is_some_and(|error| error.starts_with("missing_feature:")) {
        return HAIDER_NEEDS_INPUT_FEATURE_MISSING.to_string();
    }
    if initial_reachability == SessionNeedsInputReachability::NoConnection && detail.is_none() {
        return HAIDER_NEEDS_INPUT_NO_CONNECTION.to_string();
    }
    let detail = detail.unwrap_or("session.list or session.attach disconnected or timed out");
    format!("{HAIDER_NEEDS_INPUT_RPC_FAILED}: {detail}")
}

#[cfg(unix)]
fn session_answer_menu_result(
    initial_reachability: SessionNeedsInputReachability,
    answer: Result<Option<Value>, SessionAnswerMenuRpcError>,
) -> Result<Value, String> {
    match answer {
        Ok(Some(receipt)) => Ok(receipt),
        Ok(None) => Err(session_answer_menu_pre_answer_error(
            initial_reachability,
            None,
        )),
        Err(SessionAnswerMenuRpcError::BeforeAnswer(error)) => Err(
            session_answer_menu_pre_answer_error(initial_reachability, Some(&error)),
        ),
        // The actor checks this gate before writing menu.answer, so feature
        // loss here is conclusive and must receive the same public feature
        // diagnosis as feature loss during session.list/session.attach.
        Err(SessionAnswerMenuRpcError::Answer(error)) if error.starts_with("missing_feature:") => {
            Err(HAIDER_NEEDS_INPUT_FEATURE_MISSING.to_string())
        }
        Err(SessionAnswerMenuRpcError::Answer(error)) => Err(error),
    }
}

fn session_answer_menu_option_index(
    needs_input: &Value,
    menu_id: &str,
    request_seq: u64,
    worker_generation: u64,
    option_key: &str,
) -> Result<u32, String> {
    let stored_fence_matches = needs_input.get("menu_id").and_then(Value::as_str) == Some(menu_id)
        && needs_input.get("request_seq").and_then(Value::as_u64) == Some(request_seq)
        && needs_input.get("worker_generation").and_then(Value::as_u64) == Some(worker_generation);
    if !stored_fence_matches {
        return Err(HAIDER_NEEDS_INPUT_STALE.to_string());
    }

    needs_input
        .get("options")
        .and_then(Value::as_array)
        .and_then(|options| {
            options
                .iter()
                .position(|option| option.get("key").and_then(Value::as_str) == Some(option_key))
        })
        .and_then(|index| u32::try_from(index).ok())
        .ok_or_else(|| HAIDER_NEEDS_INPUT_STALE.to_string())
}

#[cfg(unix)]
#[derive(Clone)]
struct SessionAnswerMenuReplay {
    command_id: String,
    provider_session_id: String,
    option_index: u32,
}

#[cfg(unix)]
static SESSION_ANSWER_MENU_REPLAYS: OnceLock<StdMutex<VecDeque<SessionAnswerMenuReplay>>> =
    OnceLock::new();

#[cfg(unix)]
fn session_answer_menu_replays() -> &'static StdMutex<VecDeque<SessionAnswerMenuReplay>> {
    SESSION_ANSWER_MENU_REPLAYS.get_or_init(|| StdMutex::new(VecDeque::new()))
}

#[cfg(unix)]
fn session_answer_menu_replay_option_index(
    command_id: &str,
    provider_session_id: &str,
) -> Option<u32> {
    session_answer_menu_replays()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .iter()
        .find(|replay| {
            replay.command_id == command_id && replay.provider_session_id == provider_session_id
        })
        .map(|replay| replay.option_index)
}

#[cfg(unix)]
fn session_answer_menu_remember_replay(
    command_id: String,
    provider_session_id: String,
    option_index: u32,
) {
    let mut replays = session_answer_menu_replays()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    replays.retain(|replay| replay.command_id != command_id);
    if replays.len() >= SESSION_ANSWER_MENU_REPLAY_LIMIT {
        replays.pop_front();
    }
    replays.push_back(SessionAnswerMenuReplay {
        command_id,
        provider_session_id,
        option_index,
    });
}

#[cfg(unix)]
fn session_answer_menu_forget_replay(command_id: &str) {
    session_answer_menu_replays()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .retain(|replay| replay.command_id != command_id);
}

#[cfg(unix)]
fn session_answer_menu_attempt_option_index(
    command_id: &str,
    provider_session_id: &str,
    needs_input: &Value,
    menu_id: &str,
    request_seq: u64,
    worker_generation: u64,
    option_key: &str,
) -> Result<u32, String> {
    // Only an answer whose receipt was uncertain may bypass the current card.
    // Its option index was validated before the original dispatch; retaining it
    // lets the stable command id reach the daemon after the committed park clears.
    if let Some(option_index) =
        session_answer_menu_replay_option_index(command_id, provider_session_id)
    {
        return Ok(option_index);
    }
    session_answer_menu_option_index(
        needs_input,
        menu_id,
        request_seq,
        worker_generation,
        option_key,
    )
}

#[cfg(unix)]
fn session_answer_menu_context(
    local_session_id: &str,
    menu_id: &str,
    request_seq: u64,
    worker_generation: u64,
    option_key: &str,
) -> Result<(String, u32, String), String> {
    let connection = super::sessions_open_database()?;
    let row = super::sessions_row_by_id(&connection, local_session_id.trim())?;
    let provider_session_id = row.provider_session_id.trim();
    if provider_session_id.is_empty() {
        return Err("Haider session id is not bound yet.".to_string());
    }
    let command_id = session_answer_menu_command_id(
        provider_session_id,
        menu_id,
        request_seq,
        worker_generation,
        option_key,
    );
    let needs_input = row.needs_input();
    let option_index = session_answer_menu_attempt_option_index(
        &command_id,
        provider_session_id,
        &needs_input,
        menu_id,
        request_seq,
        worker_generation,
        option_key,
    )?;
    Ok((provider_session_id.to_string(), option_index, command_id))
}

#[cfg(unix)]
fn session_answer_menu_command_id(
    provider_session_id: &str,
    menu_id: &str,
    request_seq: u64,
    worker_generation: u64,
    option_key: &str,
) -> String {
    fn append_text(material: &mut Vec<u8>, value: &str) {
        material.extend_from_slice(&(value.len() as u64).to_be_bytes());
        material.extend_from_slice(value.as_bytes());
    }

    let mut material = Vec::new();
    material.extend_from_slice(b"diffforge-menu-answer-v1\n");
    append_text(&mut material, provider_session_id);
    append_text(&mut material, menu_id);
    material.extend_from_slice(&request_seq.to_be_bytes());
    material.extend_from_slice(&worker_generation.to_be_bytes());
    append_text(&mut material, option_key);
    format!("diffforge-menu-answer-{}", hex(&blake3_hash(&material)))
}

/// Derived, not minted: a retry after a lost reply must replay the SAME
/// cancel rather than issue a second one against whatever is running by then.
#[cfg(unix)]
fn session_cancel_turn_command_id(
    provider_session_id: &str,
    run_id: &str,
    worker_generation: u64,
) -> String {
    fn append_text(material: &mut Vec<u8>, value: &str) {
        material.extend_from_slice(&(value.len() as u64).to_be_bytes());
        material.extend_from_slice(value.as_bytes());
    }

    let mut material = Vec::new();
    material.extend_from_slice(b"diffforge-turn-cancel-v1\n");
    append_text(&mut material, provider_session_id);
    append_text(&mut material, run_id);
    material.extend_from_slice(&worker_generation.to_be_bytes());
    format!("diffforge-turn-cancel-{}", hex(&blake3_hash(&material)))
}

#[cfg(unix)]
fn session_answer_menu_receipt(
    response: Option<Result<ResponseBody, String>>,
) -> Result<Value, String> {
    let response = response.ok_or_else(|| HAIDER_NEEDS_INPUT_ANSWER_UNCERTAIN.to_string())??;
    match response {
        receipt @ ResponseBody::MenuAnswer { .. } => serde_json::to_value(receipt)
            .map_err(|error| format!("Unable to encode menu.answer receipt: {error}")),
        _ => Err("menu.answer response method mismatch".to_string()),
    }
}

#[cfg(unix)]
enum SessionAnswerMenuRpcError {
    BeforeAnswer(String),
    Answer(String),
}

#[cfg(unix)]
fn session_answer_menu_update_replay(
    command_id: &str,
    provider_session_id: &str,
    option_index: u32,
    answer: &Result<Option<Value>, SessionAnswerMenuRpcError>,
) {
    match answer {
        Ok(Some(_)) => session_answer_menu_forget_replay(command_id),
        Err(SessionAnswerMenuRpcError::Answer(error))
            if error == HAIDER_NEEDS_INPUT_ANSWER_UNCERTAIN =>
        {
            session_answer_menu_remember_replay(
                command_id.to_string(),
                provider_session_id.to_string(),
                option_index,
            );
        }
        Err(SessionAnswerMenuRpcError::Answer(error))
            if matches!(error.as_str(), "already_resolved" | "stale_generation") =>
        {
            session_answer_menu_forget_replay(command_id);
        }
        Ok(None)
        | Err(SessionAnswerMenuRpcError::BeforeAnswer(_))
        | Err(SessionAnswerMenuRpcError::Answer(_)) => {}
    }
}

#[cfg(unix)]
async fn session_answer_menu_rpc_inner(
    command_id: String,
    session_id: String,
    menu_id: String,
    request_seq: u64,
    worker_generation: u64,
    option_key: String,
    option_index: u32,
) -> Result<Option<Value>, SessionAnswerMenuRpcError> {
    let Some(summary) = session_needs_input_summary(&session_id)
        .await
        .map_err(SessionAnswerMenuRpcError::BeforeAnswer)?
    else {
        return Ok(None);
    };
    let head_seq = config_u64(summary.get("head_seq")).ok_or_else(|| {
        SessionAnswerMenuRpcError::BeforeAnswer("session summary head_seq was missing".to_string())
    })?;
    let Some(response) = session_needs_input_request(RequestBody::SessionAttach {
        session_id: session_id.clone(),
        after_seq: head_seq,
        mode: AttachMode::Control,
        sealed_replay: false,
    })
    .await
    .map_err(SessionAnswerMenuRpcError::BeforeAnswer)?
    else {
        return Ok(None);
    };
    let ResponseBody::SessionAttach {
        attachment_id,
        attach_state,
    } = response
    else {
        return Err(SessionAnswerMenuRpcError::BeforeAnswer(
            "session.attach response method mismatch".to_string(),
        ));
    };
    if attach_state.session_id != session_id {
        let _ = session_needs_input_request(RequestBody::SessionDetach { attachment_id }).await;
        return Err(SessionAnswerMenuRpcError::BeforeAnswer(
            "session.attach response session mismatch".to_string(),
        ));
    }

    let answer = async {
        let response = rpc_menu_answer(
            command_id,
            session_id,
            menu_id,
            request_seq,
            worker_generation,
            option_key,
            option_index,
        )
        .await;
        session_answer_menu_receipt(response)
            .map(Some)
            .map_err(SessionAnswerMenuRpcError::Answer)
    }
    .await;

    let _ = session_needs_input_request(RequestBody::SessionDetach { attachment_id }).await;
    answer
}

/// Cancels a running turn. `run_id` and `worker_generation` are ONE
/// observation and ride verbatim off the row being rendered: the generation
/// fences a resurrected worker and the run id fences the specific run, so a
/// cancel that raced a turn boundary cannot kill the next turn.
///
/// Borrows a control attachment for the call, like menu.answer. Capability
/// and attachment rejections happen before any receipt is claimed, so the
/// derived command id stays safely retryable.
#[tauri::command(rename_all = "snake_case")]
pub async fn session_cancel_turn(
    session_id: String,
    run_id: String,
    worker_generation: u64,
) -> Result<Value, String> {
    #[cfg(unix)]
    {
        if !session_needs_input_available(&actor_handle().connection.borrow()) {
            return Err(HAIDER_NEEDS_INPUT_UNAVAILABLE.to_string());
        }
        if run_id.trim().is_empty() {
            return Err("turn.cancel requires the run id of the turn to stop".to_string());
        }
        let context_session_id = session_id.clone();
        let provider_session_id = tauri::async_runtime::spawn_blocking(move || {
            let connection = super::sessions_open_database()?;
            let row = super::sessions_row_by_id(&connection, context_session_id.trim())?;
            let provider_session_id = row.provider_session_id.trim();
            if provider_session_id.is_empty() {
                return Err(HAIDER_NEEDS_INPUT_UNAVAILABLE.to_string());
            }
            Ok::<String, String>(provider_session_id.to_string())
        })
        .await
        .map_err(|error| format!("Turn cancel worker failed: {error}"))??;
        return session_cancel_turn_rpc(provider_session_id, run_id, worker_generation).await;
    }
    #[cfg(not(unix))]
    {
        let _ = (session_id, run_id, worker_generation);
        Err(HAIDER_NEEDS_INPUT_UNAVAILABLE.to_string())
    }
}

#[cfg(unix)]
async fn session_cancel_turn_rpc(
    session_id: String,
    run_id: String,
    worker_generation: u64,
) -> Result<Value, String> {
    let Some(summary) = session_needs_input_summary(&session_id).await? else {
        return Err(HAIDER_NEEDS_INPUT_UNAVAILABLE.to_string());
    };
    let head_seq = config_u64(summary.get("head_seq"))
        .ok_or_else(|| "session summary head_seq was missing".to_string())?;
    let Some(response) = session_needs_input_request(RequestBody::SessionAttach {
        session_id: session_id.clone(),
        after_seq: head_seq,
        mode: AttachMode::Control,
        sealed_replay: false,
    })
    .await?
    else {
        return Err(HAIDER_NEEDS_INPUT_UNAVAILABLE.to_string());
    };
    let ResponseBody::SessionAttach {
        attachment_id,
        attach_state,
    } = response
    else {
        return Err("session.attach response method mismatch".to_string());
    };
    if attach_state.session_id != session_id {
        let _ = session_needs_input_request(RequestBody::SessionDetach { attachment_id }).await;
        return Err("session.attach response session mismatch".to_string());
    }

    let cancelled = async {
        let command_id = session_cancel_turn_command_id(&session_id, &run_id, worker_generation);
        match session_needs_input_request(RequestBody::TurnCancel {
            command_id,
            session_id,
            worker_generation,
            run_id,
        })
        .await?
        {
            Some(ResponseBody::TurnCancel {
                status,
                terminal_seq,
                run_id,
                ..
            }) => Ok(serde_json::json!({
                "status": status,
                "run_id": run_id,
                "terminal_seq": terminal_seq,
            })),
            Some(_) => Err("turn.cancel response method mismatch".to_string()),
            None => Err(HAIDER_NEEDS_INPUT_UNAVAILABLE.to_string()),
        }
    }
    .await;

    let _ = session_needs_input_request(RequestBody::SessionDetach { attachment_id }).await;
    cancelled
}

/// Opens the System Settings pane for an OS-permission park. macOS requires a
/// real user grant that no wire action can perform, so this is the side action
/// that makes the park's own option (a re-check) able to succeed. It opens on
/// the machine running the DAEMON — the one whose permission is missing —
/// which stays correct when the UI is somewhere else entirely.
///
/// The daemon keys the request by the FULL menu id (worker.rs stores
/// `request_id: menu.id`), and derives the pane itself; no client ever sends a
/// URL. Needs a control attachment, so it borrows one for the call.
#[tauri::command(rename_all = "snake_case")]
pub async fn computer_permission_open_settings(
    session_id: String,
    menu_id: String,
    permission: String,
) -> Result<Value, String> {
    #[cfg(unix)]
    {
        if !session_needs_input_available(&actor_handle().connection.borrow()) {
            return Err(HAIDER_NEEDS_INPUT_UNAVAILABLE.to_string());
        }
        let context_session_id = session_id.clone();
        let provider_session_id = tauri::async_runtime::spawn_blocking(move || {
            let connection = super::sessions_open_database()?;
            let row = super::sessions_row_by_id(&connection, context_session_id.trim())?;
            let provider_session_id = row.provider_session_id.trim();
            if provider_session_id.is_empty() {
                return Err(HAIDER_NEEDS_INPUT_UNAVAILABLE.to_string());
            }
            Ok::<String, String>(provider_session_id.to_string())
        })
        .await
        .map_err(|error| format!("Permission settings worker failed: {error}"))??;
        return computer_permission_open_settings_rpc(provider_session_id, menu_id, permission)
            .await;
    }
    #[cfg(not(unix))]
    {
        let _ = (session_id, menu_id, permission);
        Err(HAIDER_NEEDS_INPUT_UNAVAILABLE.to_string())
    }
}

#[cfg(unix)]
async fn computer_permission_open_settings_rpc(
    session_id: String,
    menu_id: String,
    permission: String,
) -> Result<Value, String> {
    let Some(summary) = session_needs_input_summary(&session_id).await? else {
        return Err(HAIDER_NEEDS_INPUT_UNAVAILABLE.to_string());
    };
    let head_seq = config_u64(summary.get("head_seq"))
        .ok_or_else(|| "session summary head_seq was missing".to_string())?;
    let Some(response) = session_needs_input_request(RequestBody::SessionAttach {
        session_id: session_id.clone(),
        after_seq: head_seq,
        mode: AttachMode::Control,
        sealed_replay: false,
    })
    .await?
    else {
        return Err(HAIDER_NEEDS_INPUT_UNAVAILABLE.to_string());
    };
    let ResponseBody::SessionAttach {
        attachment_id,
        attach_state,
    } = response
    else {
        return Err("session.attach response method mismatch".to_string());
    };
    if attach_state.session_id != session_id {
        let _ = session_needs_input_request(RequestBody::SessionDetach { attachment_id }).await;
        return Err("session.attach response session mismatch".to_string());
    }

    let opened = async {
        match session_needs_input_request(RequestBody::ComputerPermissionOpenSettings {
            session_id,
            request_id: menu_id,
            permission,
        })
        .await?
        {
            Some(ResponseBody::ComputerPermissionOpenSettings { permission }) => {
                Ok(serde_json::json!({ "permission": permission }))
            }
            Some(_) => {
                Err("computer.permission_open_settings response method mismatch".to_string())
            }
            None => Err(HAIDER_NEEDS_INPUT_UNAVAILABLE.to_string()),
        }
    }
    .await;

    let _ = session_needs_input_request(RequestBody::SessionDetach { attachment_id }).await;
    opened
}

/// Resolves a daemon-owned needs-input card using the exact staleness fence
/// supplied by the frontend. The option index is recovered from the locally
/// stored card because the daemon validates the committed key/index pair.
#[tauri::command(rename_all = "snake_case")]
pub async fn session_answer_menu(
    session_id: String,
    menu_id: String,
    request_seq: u64,
    worker_generation: u64,
    option_key: String,
) -> Result<Value, String> {
    #[cfg(unix)]
    {
        // Validate the complete daemon fence before considering reachability.
        // An offline route must never disguise a stale or incomplete card.
        let context_session_id = session_id;
        let context_menu_id = menu_id.clone();
        let context_option_key = option_key.clone();
        let context = tauri::async_runtime::spawn_blocking(move || {
            session_answer_menu_context(
                &context_session_id,
                &context_menu_id,
                request_seq,
                worker_generation,
                &context_option_key,
            )
        })
        .await
        .map_err(|error| format!("Session menu answer worker failed: {error}"))?;
        let initial_reachability =
            session_needs_input_reachability(&actor_handle().connection.borrow());
        // Unlike the old snapshot-only gate, the disconnected arm reaches the
        // actor. During backoff it wakes the loop and starts a socket attempt.
        let (provider_session_id, option_index, command_id) =
            session_answer_menu_prepare(context, initial_reachability, nudge_rpc_reconnect)?;
        let answer = session_answer_menu_rpc_inner(
            command_id.clone(),
            provider_session_id.clone(),
            menu_id,
            request_seq,
            worker_generation,
            option_key,
            option_index,
        )
        .await;
        session_answer_menu_update_replay(&command_id, &provider_session_id, option_index, &answer);
        return session_answer_menu_result(initial_reachability, answer);
    }
    #[cfg(not(unix))]
    {
        let _ = (
            session_id,
            menu_id,
            request_seq,
            worker_generation,
            option_key,
        );
        Err(HAIDER_NEEDS_INPUT_UNAVAILABLE.to_string())
    }
}

#[cfg(unix)]
async fn resident_turn_submit_rpc_inner(
    session_id: String,
    prompt: String,
    mode: DeliveryMode,
    explicit_mode: bool,
) -> Result<Option<ResidentTurnSubmit>, String> {
    let Some(summary) = resident_turn_submit_session_summary(&session_id, explicit_mode).await?
    else {
        return Ok(None);
    };
    let head_seq = config_u64(summary.get("head_seq"))
        .ok_or_else(|| "session summary head_seq was missing".to_string())?;
    let Some(response) = resident_turn_submit_request(
        RequestBody::SessionAttach {
            session_id: session_id.clone(),
            after_seq: head_seq,
            mode: AttachMode::Control,
            sealed_replay: false,
        },
        explicit_mode,
    )
    .await?
    else {
        return Ok(None);
    };
    let ResponseBody::SessionAttach {
        attachment_id,
        attach_state,
    } = response
    else {
        return Err("session.attach response method mismatch".to_string());
    };
    if attach_state.session_id != session_id {
        let _ = resident_turn_submit_request(
            RequestBody::SessionDetach { attachment_id },
            explicit_mode,
        )
        .await;
        return Err("session.attach response session mismatch".to_string());
    }

    let submit = async {
        let Some(response) = resident_turn_submit_request(
            resident_turn_submit_body(
                resident_turn_submit_command_id(),
                session_id.clone(),
                attach_state.worker_generation,
                prompt,
                mode,
            ),
            explicit_mode,
        )
        .await?
        else {
            return Ok(None);
        };
        match response {
            ResponseBody::TurnSubmit {
                session_id: accepted_session,
                run_id,
                accepted_seq,
                worker_generation: _,
                disposition,
            } if accepted_session == session_id => Ok(Some(ResidentTurnSubmit {
                session_id: accepted_session,
                run_id,
                accepted_seq,
                disposition,
            })),
            ResponseBody::TurnSubmit { .. } => {
                Err("turn.submit response session mismatch".to_string())
            }
            _ => Err("turn.submit response method mismatch".to_string()),
        }
    }
    .await;

    let _ =
        resident_turn_submit_request(RequestBody::SessionDetach { attachment_id }, explicit_mode)
            .await;
    submit
}

fn resident_turn_submit_body(
    command_id: String,
    session_id: String,
    worker_generation: u64,
    text: String,
    mode: DeliveryMode,
) -> RequestBody {
    RequestBody::TurnSubmitFromCli {
        command_id,
        session_id,
        worker_generation,
        text,
        attachments: Vec::new(),
        mode,
    }
}

/// Submits a text-only follow-up turn through the daemon-owned resident
/// connection. `None` means this connection cannot use the optional door;
/// callers must preserve the CLI submit fallback in that case.
pub(crate) async fn resident_turn_submit_rpc(
    session_id: String,
    prompt: String,
    attachments: &[String],
    mode: Option<DeliveryMode>,
) -> Option<Result<ResidentTurnSubmit, String>> {
    #[cfg(unix)]
    {
        if attachments
            .iter()
            .any(|attachment| !attachment.trim().is_empty())
        {
            return None;
        }
        let explicit_mode = mode.is_some();
        return match resident_turn_submit_rpc_inner(
            session_id,
            prompt,
            mode.unwrap_or(DeliveryMode::Queue),
            explicit_mode,
        )
        .await
        {
            Ok(Some(receipt)) => Some(Ok(receipt)),
            Ok(None) => None,
            Err(error) => Some(Err(error)),
        };
    }
    #[cfg(not(unix))]
    {
        let _ = (session_id, prompt, attachments, mode);
        None
    }
}

#[cfg(unix)]
async fn session_seen_rpc_inner(session_id: String) -> Result<Option<SessionSeen>, String> {
    let Some(summary) = session_seen_session_summary(&session_id).await? else {
        return Ok(None);
    };
    let head_seq = config_u64(summary.get("head_seq"))
        .ok_or_else(|| "session summary head_seq was missing".to_string())?;
    let Some(response) = session_seen_request(RequestBody::SessionAttach {
        session_id: session_id.clone(),
        after_seq: head_seq,
        mode: AttachMode::Control,
        sealed_replay: false,
    })
    .await?
    else {
        return Ok(None);
    };
    let ResponseBody::SessionAttach {
        attachment_id,
        attach_state,
    } = response
    else {
        return Err("session.attach response method mismatch".to_string());
    };
    if attach_state.session_id != session_id {
        let _ = session_seen_request(RequestBody::SessionDetach { attachment_id }).await;
        return Err("session.attach response session mismatch".to_string());
    }

    let seen = async {
        let Some(response) = session_seen_request(RequestBody::SessionSeen {
            command_id: session_seen_command_id(),
            session_id: session_id.clone(),
            worker_generation: attach_state.worker_generation,
        })
        .await?
        else {
            return Ok(None);
        };
        match response {
            ResponseBody::SessionSeen {
                session_id: seen_session,
                seen_at_ms,
                seen_seq,
                worker_generation,
            } if seen_session == session_id => Ok(Some(SessionSeen {
                session_id: seen_session,
                seen_at_ms,
                seen_seq,
                worker_generation,
            })),
            ResponseBody::SessionSeen { .. } => {
                Err("session.seen response session mismatch".to_string())
            }
            _ => Err("session.seen response method mismatch".to_string()),
        }
    }
    .await;

    let _ = session_seen_request(RequestBody::SessionDetach { attachment_id }).await;
    seen
}

/// Marks a session as seen through the daemon-owned connection. `None`
/// means this connection cannot use the optional attention-state door.
pub(crate) async fn session_seen_rpc(session_id: String) -> Option<Result<SessionSeen, String>> {
    #[cfg(unix)]
    {
        if !session_seen_available(&actor_handle().connection.borrow()) {
            return None;
        }
        return match session_seen_rpc_inner(session_id).await {
            Ok(Some(receipt)) => Some(Ok(receipt)),
            Ok(None) => None,
            Err(error) if error.starts_with("missing_feature:") => None,
            Err(error) => Some(Err(error)),
        };
    }
    #[cfg(not(unix))]
    {
        let _ = session_id;
        None
    }
}

#[cfg(unix)]
async fn command_answer(
    answer: oneshot::Receiver<SurfaceCommandStatus>,
    accepted_if_timed_out: bool,
) -> SurfaceCommandStatus {
    tokio::time::timeout(COMMAND_REPLY_TIMEOUT, answer)
        .await
        .ok()
        .and_then(Result::ok)
        .unwrap_or_else(|| SurfaceCommandStatus::inactive(accepted_if_timed_out))
}

#[cfg(unix)]
fn publish_account_roster_watch_state(
    watch_tx: &watch::Sender<AccountRosterWatchState>,
    window: Option<&tauri::WebviewWindow>,
    state: AccountRosterWatchState,
) {
    let changed = *watch_tx.borrow() != state;
    watch_tx.send_replace(state.clone());
    if changed {
        if let Some(window) = window {
            let _ = window.emit(
                ACCOUNT_ROSTER_CHANGED_EVENT,
                AccountRosterChangedPayload {
                    revision: None,
                    watch: state,
                },
            );
        }
    }
}

#[cfg(unix)]
fn account_roster_transport_unavailable() -> AccountRosterWatchState {
    AccountRosterWatchState::unavailable(
        "The Haider RPC connection is unavailable for a live account roster watch.",
    )
}

#[cfg(unix)]
async fn run_actor(
    mut commands: mpsc::UnboundedReceiver<ActorCommand>,
    connection_tx: watch::Sender<ConnectionSnapshot>,
    resident_binding_tx: watch::Sender<ResidentSessionBindingSnapshot>,
    haider_code_plan_status_tx: watch::Sender<HaiderCodePlanStatusSnapshot>,
    account_roster_watch_tx: watch::Sender<AccountRosterWatchState>,
) {
    let mut subscriptions: HashMap<String, Subscription> = HashMap::new();
    let mut last_published_revision: HashMap<String, u64> = HashMap::new();
    let mut roster_app = None;
    let mut account_roster_window = None;
    let mut reconnect_delay = Duration::from_millis(100);
    let mut connection_serial = 0_u64;

    loop {
        while let Ok(command) = commands.try_recv() {
            apply_disconnected_command(
                command,
                &mut subscriptions,
                &mut last_published_revision,
                &mut roster_app,
                &mut account_roster_window,
                &account_roster_watch_tx,
            );
        }

        let resolved = resolve_socket_path();
        #[cfg(debug_assertions)]
        eprintln!("[ade-rpc] resolve -> {resolved:?}");
        let Some(socket_path) = resolved else {
            if let Some(app) = roster_app.as_ref() {
                super::haider_bridge_roster_connection_unreachable(app);
            }
            publish_disconnected(&connection_tx);
            publish_account_roster_watch_state(
                &account_roster_watch_tx,
                account_roster_window.as_ref(),
                account_roster_transport_unavailable(),
            );
            if !wait_disconnected(
                &mut commands,
                &mut subscriptions,
                &mut last_published_revision,
                &mut roster_app,
                &mut account_roster_window,
                &account_roster_watch_tx,
                reconnect_delay,
            )
            .await
            {
                return;
            }
            reconnect_delay = (reconnect_delay * 2).min(Duration::from_secs(5));
            continue;
        };

        let attempt =
            tokio::time::timeout(HANDSHAKE_TIMEOUT, connect_and_handshake(&socket_path)).await;
        #[cfg(debug_assertions)]
        match &attempt {
            Err(_) => eprintln!("[ade-rpc] handshake TIMEOUT on {socket_path:?}"),
            Ok(Err(error)) => eprintln!("[ade-rpc] handshake FAILED on {socket_path:?}: {error}"),
            Ok(Ok((_, welcome))) => eprintln!(
                "[ade-rpc] connected, {} features, needs_input={}",
                welcome.features.len(),
                welcome.features.contains(FEATURE_SESSION_NEEDS_INPUT_V1)
            ),
        }
        let connected = attempt.ok().and_then(Result::ok);
        let Some((mut stream, welcome)) = connected else {
            if let Some(app) = roster_app.as_ref() {
                super::haider_bridge_roster_connection_unreachable(app);
            }
            publish_disconnected(&connection_tx);
            publish_account_roster_watch_state(
                &account_roster_watch_tx,
                account_roster_window.as_ref(),
                account_roster_transport_unavailable(),
            );
            if !wait_disconnected(
                &mut commands,
                &mut subscriptions,
                &mut last_published_revision,
                &mut roster_app,
                &mut account_roster_window,
                &account_roster_watch_tx,
                reconnect_delay,
            )
            .await
            {
                return;
            }
            reconnect_delay = (reconnect_delay * 2).min(Duration::from_secs(5));
            continue;
        };

        reconnect_delay = Duration::from_millis(100);
        connection_serial = connection_serial.saturating_add(1);
        let roster_identity = RosterConnectionIdentity {
            profile_id: welcome.profile_id.clone(),
            daemon_generation: welcome.daemon_generation,
            connection_serial,
        };
        let roster_bootstrap_pending = roster_app.as_ref().is_some_and(|app| {
            super::haider_bridge_roster_connection_pending(app, roster_identity.clone())
        });
        let mut snapshot = ConnectionSnapshot {
            connected: true,
            roster_watch_active: false,
            roster_identity: Some(roster_identity.clone()),
            features: welcome.features.clone(),
            capabilities_granted: welcome.capabilities_granted.clone(),
            frame_limit: (welcome.frame_limit as usize).min(DEFAULT_FRAME_LIMIT),
        };
        ROSTER_WATCH_ACTIVE.store(false, Ordering::Release);
        let encoding = match WireEncoding::from_welcome(&welcome) {
            Ok(encoding) => encoding,
            Err(_) => {
                if let Some(app) = roster_app.as_ref() {
                    super::haider_bridge_roster_connection_unreachable(app);
                }
                publish_disconnected(&connection_tx);
                continue;
            }
        };
        publish_resident_binding(
            &resident_binding_tx,
            roster_app.as_ref(),
            ResidentSessionBindingSnapshot::for_features(&snapshot.features),
        );
        let plan_status = HaiderCodePlanStatusSnapshot::for_features(
            &snapshot.features,
            &haider_code_plan_status_tx.borrow(),
        );
        haider_code_plan_status_tx.send_replace(plan_status);
        let mut next_request = 1_u64;
        let mut setup_failed = false;
        if roster_app.is_some() && snapshot.can_watch_roster() {
            match send_roster_watch(
                &mut stream,
                snapshot.frame_limit,
                encoding,
                &mut next_request,
            )
            .await
            {
                // Health (ROSTER_WATCH_ACTIVE) is NOT asserted on write:
                // a daemon-rejected watch would otherwise stretch bridge
                // reconciliation to 30min with no live data. It flips true
                // on the first SessionRosterDelta — proof data flows.
                Ok(()) => snapshot.roster_watch_active = true,
                Err(_) => setup_failed = true,
            }
        }
        if snapshot.can_watch_surfaces() {
            let session_ids = subscriptions.keys().cloned().collect::<Vec<_>>();
            for session_id in session_ids {
                if send_surface_watch(
                    &mut stream,
                    snapshot.frame_limit,
                    encoding,
                    &mut next_request,
                    session_id,
                )
                .await
                .is_err()
                {
                    setup_failed = true;
                    break;
                }
            }
        }

        publish_connection(&connection_tx, snapshot.clone());
        if roster_bootstrap_pending {
            if let Some(app) = roster_app.as_ref() {
                // Reuse the bridge's one complete paginated list path. This is
                // after identity publication but before run_connected can
                // enqueue any later daemon delta.
                super::haider_bridge_seed_from_rpc(app.clone());
            }
        }

        if !setup_failed {
            run_connected(
                &mut stream,
                snapshot,
                encoding,
                &mut commands,
                &mut subscriptions,
                &mut last_published_revision,
                &mut roster_app,
                &mut account_roster_window,
                &mut next_request,
                &resident_binding_tx,
                &haider_code_plan_status_tx,
                &account_roster_watch_tx,
            )
            .await;
        }
        let binding = resident_binding_tx.borrow().without_binding();
        publish_resident_binding(&resident_binding_tx, roster_app.as_ref(), binding);
        if let Some(app) = roster_app.as_ref() {
            super::haider_bridge_roster_connection_unreachable(app);
        }
        publish_disconnected(&connection_tx);
        publish_account_roster_watch_state(
            &account_roster_watch_tx,
            account_roster_window.as_ref(),
            account_roster_transport_unavailable(),
        );
    }
}

#[cfg(unix)]
fn publish_resident_binding(
    binding_tx: &watch::Sender<ResidentSessionBindingSnapshot>,
    app: Option<&AppHandle>,
    snapshot: ResidentSessionBindingSnapshot,
) {
    binding_tx.send_replace(snapshot.clone());
    if let Some(app) = app {
        let _ = app.emit(RESIDENT_SESSION_BINDING_EVENT, snapshot);
    }
}

#[cfg(unix)]
fn publish_connection(
    connection_tx: &watch::Sender<ConnectionSnapshot>,
    snapshot: ConnectionSnapshot,
) {
    connection_tx.send_replace(snapshot);
}

#[cfg(unix)]
fn publish_disconnected(connection_tx: &watch::Sender<ConnectionSnapshot>) {
    let mut snapshot = connection_tx.borrow().clone();
    snapshot.connected = false;
    snapshot.roster_watch_active = false;
    snapshot.roster_identity = None;
    ROSTER_WATCH_ACTIVE.store(false, Ordering::Release);
    publish_connection(connection_tx, snapshot);
}

#[cfg(unix)]
async fn wait_disconnected(
    commands: &mut mpsc::UnboundedReceiver<ActorCommand>,
    subscriptions: &mut HashMap<String, Subscription>,
    last_published_revision: &mut HashMap<String, u64>,
    roster_app: &mut Option<AppHandle>,
    account_roster_window: &mut Option<tauri::WebviewWindow>,
    account_roster_watch_tx: &watch::Sender<AccountRosterWatchState>,
    delay: Duration,
) -> bool {
    tokio::select! {
        command = commands.recv() => {
            let Some(command) = command else { return false; };
            apply_disconnected_command(
                command,
                subscriptions,
                last_published_revision,
                roster_app,
                account_roster_window,
                account_roster_watch_tx,
            );
        }
        _ = tokio::time::sleep(delay) => {}
    }
    true
}

#[cfg(unix)]
fn apply_disconnected_command(
    command: ActorCommand,
    subscriptions: &mut HashMap<String, Subscription>,
    _last_published_revision: &mut HashMap<String, u64>,
    roster_app: &mut Option<AppHandle>,
    account_roster_window: &mut Option<tauri::WebviewWindow>,
    account_roster_watch_tx: &watch::Sender<AccountRosterWatchState>,
) {
    match command {
        ActorCommand::ReconnectNow => {}
        ActorCommand::RosterAttach { app } => *roster_app = Some(app),
        ActorCommand::AccountRosterAttach { window, reply } => {
            *account_roster_window = Some(window);
            let state = account_roster_transport_unavailable();
            publish_account_roster_watch_state(
                account_roster_watch_tx,
                account_roster_window.as_ref(),
                state.clone(),
            );
            let _ = reply.send(state);
        }
        ActorCommand::QueueAttach {
            app,
            session_id,
            reply,
        } => {
            subscriptions
                .entry(session_id.clone())
                .and_modify(|subscription| subscription.app = app.clone())
                .or_insert_with(|| Subscription::new(app, &session_id));
            let _ = reply.send(Err(QueueCommandError::unavailable(
                "The Haider RPC connection disconnected before the live queue watch could attach.",
            )));
        }
        ActorCommand::RpcRequest { reply, .. } => {
            let _ = reply.send(None);
        }
        ActorCommand::DescendantAttach { reply, .. } => {
            let _ = reply.send(Err(
                "session.descendants.attach unavailable: no ADE connection".to_string(),
            ));
        }
        ActorCommand::DescendantDetach { reply, .. } => {
            let _ = reply.send(Err(
                "session_descendants_detach unavailable: no ADE connection".to_string(),
            ));
        }
        ActorCommand::LoomWatch { reply, .. } => {
            let _ = reply.send(Err(LoomCommandError::unavailable(
                "loom.watch unavailable: no ADE connection",
            )));
        }
        ActorCommand::MenuAnswer { reply, .. } => {
            let _ = reply.send(None);
        }
        ActorCommand::Attach {
            app,
            session_id,
            reply,
        } => {
            subscriptions
                .entry(session_id.clone())
                .and_modify(|subscription| subscription.app = app.clone())
                .or_insert_with(|| Subscription::new(app, &session_id));
            let _ = reply.send(SurfaceCommandStatus::inactive(true));
        }
        ActorCommand::Detach { session_id, reply } => {
            subscriptions.remove(&session_id);
            let _ = reply.send(SurfaceCommandStatus::inactive(true));
        }
        ActorCommand::PublishInput { reply, .. } => {
            let _ = reply.send(SurfaceCommandStatus::inactive(false));
        }
    }
}

#[cfg(unix)]
async fn run_connected(
    stream: &mut UnixStream,
    connection: ConnectionSnapshot,
    encoding: WireEncoding,
    commands: &mut mpsc::UnboundedReceiver<ActorCommand>,
    subscriptions: &mut HashMap<String, Subscription>,
    last_published_revision: &mut HashMap<String, u64>,
    roster_app: &mut Option<AppHandle>,
    account_roster_window: &mut Option<tauri::WebviewWindow>,
    next_request: &mut u64,
    resident_binding_tx: &watch::Sender<ResidentSessionBindingSnapshot>,
    haider_code_plan_status_tx: &watch::Sender<HaiderCodePlanStatusSnapshot>,
    account_roster_watch_tx: &watch::Sender<AccountRosterWatchState>,
) {
    let mut heartbeat = tokio::time::interval(PING_INTERVAL);
    heartbeat.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let mut ping_nonce = 1_u64;
    let mut unacked_pings: VecDeque<(u64, Instant)> = VecDeque::new();
    let mut pending_requests: HashMap<String, PendingRpcRequest> = HashMap::new();
    let mut pending_queue_attaches: HashMap<String, String> = HashMap::new();
    let mut pending_descendant_attaches: HashMap<String, PendingDescendantAttach> = HashMap::new();
    let mut pending_descendant_detaches: HashMap<String, PendingDescendantDetach> = HashMap::new();
    let mut descendant_forwarders = DescendantForwarders::new();
    let mut pending_loom_watches: HashMap<String, PendingLoomWatch> = HashMap::new();
    let mut loom_registry_forwarders = LoomRegistryForwarders::new();
    let mut pending_account_roster_watch = None;
    let mut account_roster_watch_waiters = Vec::new();
    let mut decoder = StreamingFrameDecoder::default();
    let mut scratch = [0_u8; 16 * 1024];

    if account_roster_window.is_some() {
        match account_roster_watch_preflight(&connection) {
            Ok(()) => {
                let pending = AccountRosterWatchState::unavailable(
                    "The account roster watch is awaiting daemon readiness.",
                );
                publish_account_roster_watch_state(
                    account_roster_watch_tx,
                    account_roster_window.as_ref(),
                    pending,
                );
                match send_account_roster_watch(
                    stream,
                    connection.frame_limit,
                    encoding,
                    next_request,
                )
                .await
                {
                    Ok(request_id) => pending_account_roster_watch = Some(request_id),
                    Err(error) => {
                        let state = AccountRosterWatchState::unavailable(format!(
                            "Unable to write account.list_watch: {error}"
                        ));
                        publish_account_roster_watch_state(
                            account_roster_watch_tx,
                            account_roster_window.as_ref(),
                            state,
                        );
                        return;
                    }
                }
            }
            Err(state) => publish_account_roster_watch_state(
                account_roster_watch_tx,
                account_roster_window.as_ref(),
                state,
            ),
        }
    }

    for subscription in subscriptions.values_mut() {
        subscription.queue_attachment_id = None;
        subscription.queue_attach_pending = false;
    }
    if connection.can_watch_queue() {
        for session_id in subscriptions.keys().cloned().collect::<Vec<_>>() {
            if send_queue_watch(
                stream,
                connection.frame_limit,
                encoding,
                next_request,
                subscriptions,
                &mut pending_queue_attaches,
                session_id,
            )
            .await
            .is_err()
            {
                return;
            }
        }
    }

    loop {
        let frame = match decoder.next(connection.frame_limit, encoding) {
            Ok(Some(frame)) => frame,
            Ok(None) => {
                tokio::select! {
                    command = commands.recv() => {
                        let Some(command) = command else { return; };
                        let keep_connection = apply_connected_command(
                            command,
                            stream,
                            &connection,
                            encoding,
                            subscriptions,
                            last_published_revision,
                            roster_app,
                            account_roster_window,
                            &mut pending_requests,
                            &mut pending_queue_attaches,
                            &mut pending_descendant_attaches,
                            &mut pending_descendant_detaches,
                            &mut descendant_forwarders,
                            &mut pending_loom_watches,
                            &mut pending_account_roster_watch,
                            &mut account_roster_watch_waiters,
                            next_request,
                            account_roster_watch_tx,
                        ).await;
                        if !keep_connection {
                            return;
                        }
                    }
                    read = stream.read(&mut scratch) => {
                        let Ok(read) = read else { return; };
                        if read == 0 {
                            return;
                        }
                        decoder.push(&scratch[..read]);
                    }
                    _ = heartbeat.tick() => {
                        if unacked_pings
                            .front()
                            .is_some_and(|(_, sent)| sent.elapsed() >= PONG_DEADLINE)
                        {
                            return;
                        }
                        if write_frame(
                            stream,
                            &WireFrame::Ping { nonce: ping_nonce },
                            connection.frame_limit,
                            encoding,
                        )
                        .await
                        .is_err()
                        {
                            return;
                        }
                        unacked_pings.push_back((ping_nonce, Instant::now()));
                        ping_nonce = ping_nonce.saturating_add(1);
                    }
                }
                continue;
            }
            Err(_) => return,
        };
        // A decoded buffered frame gets priority over fresh commands and
        // timers; it was already read from the socket and must be kept.
        match frame {
            WireFrame::Response { request_id, body } => {
                if pending_account_roster_watch.as_deref() == Some(request_id.as_str()) {
                    pending_account_roster_watch = None;
                    let state = match account_watch_state_from_response(body) {
                        Ok(state) => state,
                        Err(reason) => {
                            eprintln!(
                                "[ade-rpc] dropping malformed account.list_watch response: {reason}"
                            );
                            AccountRosterWatchState::unavailable(reason)
                        }
                    };
                    publish_account_roster_watch_state(
                        account_roster_watch_tx,
                        account_roster_window.as_ref(),
                        state.clone(),
                    );
                    for reply in account_roster_watch_waiters.drain(..) {
                        let _ = reply.send(state.clone());
                    }
                    continue;
                }
                if let Some(session_id) = pending_queue_attaches.remove(&request_id) {
                    finish_queue_watch(subscriptions, session_id, body);
                    continue;
                }
                if let Some(pending) = pending_descendant_attaches.remove(&request_id) {
                    let cleanup_attachment_id = match &body {
                        ResponseBody::SessionDescendantsAttach {
                            attachment_id,
                            baseline,
                        } if baseline.session_id != pending.session_id => {
                            Some(attachment_id.clone())
                        }
                        _ => None,
                    };
                    let result = session_descendants_attach_response(
                        body,
                        &pending.session_id,
                        pending.lost_events_at_attach,
                    );
                    if let Ok(attachment) = &result {
                        // This registration precedes resolving the command,
                        // and therefore precedes the next buffered push.
                        descendant_forwarders.insert(attachment.attachment_id.clone(), pending.app);
                    }
                    if let Some(attachment_id) = cleanup_attachment_id {
                        let cleanup = WireFrame::Request {
                            request_id: self::request_id(next_request),
                            body: RequestBody::SessionDetach { attachment_id },
                        };
                        if write_frame(stream, &cleanup, connection.frame_limit, encoding)
                            .await
                            .is_err()
                        {
                            let _ = pending.reply.send(result);
                            return;
                        }
                    }
                    let _ = pending.reply.send(result);
                    continue;
                }
                if let Some(pending) = pending_descendant_detaches.remove(&request_id) {
                    let result = session_descendants_detach_response(body, &pending.attachment_id);
                    if result.is_ok() {
                        descendant_forwarders.remove(&pending.attachment_id);
                    }
                    let _ = pending.reply.send(result);
                    continue;
                }
                if let Some(pending) = pending_loom_watches.remove(&request_id) {
                    let result = loom_watch_response(body);
                    if let Ok(watch) = &result {
                        // Register before resolving the command so the next
                        // already-buffered registry push cannot overtake it.
                        loom_registry_forwarders.insert(watch.watch_id.clone(), pending.app);
                    }
                    let _ = pending.reply.send(result);
                    continue;
                }
                if let ResponseBody::SessionSurfaceWatching {
                    session_id,
                    input,
                    status,
                } = body.clone()
                {
                    emit_surface(subscriptions, &connection, session_id, input, status);
                }
                if let Some((reply, error_style)) = pending_requests.remove(&request_id) {
                    let _ = reply.send(Some(response_result(body, error_style)));
                }
            }
            WireFrame::SessionRosterDelta { summaries } => {
                ROSTER_WATCH_ACTIVE.store(true, Ordering::Release);
                if let Some(app) = roster_app.as_ref() {
                    super::haider_bridge_reconcile_from_summaries(app.clone(), summaries);
                }
            }
            WireFrame::AccountsChanged { revision } => {
                let watch_live = matches!(
                    &*account_roster_watch_tx.borrow(),
                    AccountRosterWatchState::Live
                );
                if !watch_live {
                    eprintln!(
                        "[ade-rpc] dropping AccountsChanged before account.list_watch was live"
                    );
                    continue;
                }
                if let Some(window) = account_roster_window.as_ref() {
                    if let Err(error) = forward_account_roster_change(revision, |payload| {
                        let _ = window.emit(ACCOUNT_ROSTER_CHANGED_EVENT, payload);
                    }) {
                        eprintln!("[ade-rpc] dropping malformed AccountsChanged: {error}");
                    }
                }
            }
            WireFrame::SessionSurfaceDelta {
                session_id,
                input,
                status,
            } => {
                emit_surface(subscriptions, &connection, session_id, input, status);
            }
            WireFrame::Event {
                attachment_id,
                session_id,
                envelope,
            } => {
                if !handle_queue_event(subscriptions, attachment_id, session_id, envelope) {
                    return;
                }
            }
            WireFrame::Lagged {
                attachment_id,
                last_queued_seq: _,
            } => {
                if emit_queue_stream_gap(subscriptions, &attachment_id) {
                    return;
                }
            }
            WireFrame::HaiderCodePlanStatus {
                provider,
                account_alias,
                outcome,
            } => {
                if connection
                    .features
                    .contains(FEATURE_HAIDER_CODE_PLAN_STATUS_V1)
                {
                    haider_code_plan_status_tx.send_replace(HaiderCodePlanStatusSnapshot {
                        supported: Some(true),
                        known: true,
                        provider: Some(provider),
                        account_alias: Some(account_alias),
                        outcome: Some(outcome),
                        received_at_ms: Some(
                            SystemTime::now()
                                .duration_since(UNIX_EPOCH)
                                .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
                                .unwrap_or(0),
                        ),
                    });
                    if let Some(app) = roster_app.as_ref() {
                        let _ = app.emit(
                            TOKENOMICS_UPDATED_EVENT,
                            serde_json::json!({ "source": "haider_code_plan_status" }),
                        );
                    }
                }
            }
            WireFrame::ResidentSessionBinding {
                session_id,
                worker_generation,
            } => {
                if let Some(snapshot) = resident_binding_snapshot_for_frame(
                    &connection.features,
                    session_id,
                    worker_generation,
                ) {
                    publish_resident_binding(resident_binding_tx, roster_app.as_ref(), snapshot);
                }
            }
            WireFrame::MonitorDelivery { watch_id, report } => {
                if connection.features.contains(FEATURE_MONITOR_DELIVERY_V1) {
                    if let Some(app) = roster_app.as_ref() {
                        let _ = app.emit(
                            MONITOR_DELIVERY_EVENT,
                            MonitorDeliveryEventV1 { watch_id, report },
                        );
                    }
                }
            }
            WireFrame::MonitorDeliveryCaughtUp {
                watch_id,
                session_id,
                high_water_cursor,
            } => {
                if connection.features.contains(FEATURE_MONITOR_DELIVERY_V1) {
                    if let Some(app) = roster_app.as_ref() {
                        let _ = app.emit(
                            MONITOR_DELIVERY_CAUGHT_UP_EVENT,
                            MonitorDeliveryCaughtUpEventV1 {
                                watch_id,
                                session_id,
                                high_water_cursor,
                            },
                        );
                    }
                }
            }
            WireFrame::LoomRegistryDelta { watch_id, delta } => {
                if connection.features.contains(FEATURE_LOOM_REGISTRY_WATCH_V1) {
                    loom_registry_forwarders.emit_delta(watch_id, delta);
                }
            }
            WireFrame::LoomRegistryCaughtUp {
                watch_id,
                high_water_cursor,
            } => {
                if connection.features.contains(FEATURE_LOOM_REGISTRY_WATCH_V1) {
                    loom_registry_forwarders.emit_caught_up(watch_id, high_water_cursor);
                }
            }
            WireFrame::SessionDescendantStream {
                attachment_id,
                event,
            } => {
                if connection
                    .features
                    .contains(FEATURE_SESSION_DESCENDANT_STREAM_V1)
                {
                    descendant_forwarders.emit_stream(attachment_id, event);
                }
            }
            WireFrame::SessionDescendantRepairRequired {
                attachment_id,
                children,
            } => {
                if connection
                    .features
                    .contains(FEATURE_SESSION_DESCENDANT_STREAM_V1)
                {
                    descendant_forwarders.emit_repair(attachment_id, children);
                }
            }
            WireFrame::Ping { nonce } => {
                if write_frame(
                    stream,
                    &WireFrame::Pong { nonce },
                    connection.frame_limit,
                    encoding,
                )
                .await
                .is_err()
                {
                    return;
                }
            }
            WireFrame::Pong { nonce } => {
                if let Some(position) = unacked_pings
                    .iter()
                    .position(|(outstanding, _)| *outstanding == nonce)
                {
                    for _ in 0..=position {
                        unacked_pings.pop_front();
                    }
                }
            }
            WireFrame::ProtocolError(error) if error.fatal => return,
            _ => {}
        }
    }
}

#[cfg(unix)]
async fn apply_connected_command(
    command: ActorCommand,
    stream: &mut UnixStream,
    connection: &ConnectionSnapshot,
    encoding: WireEncoding,
    subscriptions: &mut HashMap<String, Subscription>,
    last_published_revision: &mut HashMap<String, u64>,
    roster_app: &mut Option<AppHandle>,
    account_roster_window: &mut Option<tauri::WebviewWindow>,
    pending_requests: &mut HashMap<String, PendingRpcRequest>,
    pending_queue_attaches: &mut HashMap<String, String>,
    pending_descendant_attaches: &mut HashMap<String, PendingDescendantAttach>,
    pending_descendant_detaches: &mut HashMap<String, PendingDescendantDetach>,
    descendant_forwarders: &mut DescendantForwarders,
    pending_loom_watches: &mut HashMap<String, PendingLoomWatch>,
    pending_account_roster_watch: &mut Option<String>,
    account_roster_watch_waiters: &mut Vec<AccountRosterWatchReply>,
    next_request: &mut u64,
    account_roster_watch_tx: &watch::Sender<AccountRosterWatchState>,
) -> bool {
    match command {
        ActorCommand::ReconnectNow => true,
        ActorCommand::RosterAttach { app } => {
            *roster_app = Some(app);
            if let (Some(app), Some(identity)) =
                (roster_app.as_ref(), connection.roster_identity.clone())
            {
                if super::haider_bridge_roster_connection_pending(app, identity) {
                    super::haider_bridge_seed_from_rpc(app.clone());
                }
            }
            let active = connection.can_watch_roster();
            let written = !active
                || send_roster_watch(stream, connection.frame_limit, encoding, next_request)
                    .await
                    .is_ok();
            // Health stays pending until the first SessionRosterDelta lands.
            ROSTER_WATCH_ACTIVE.store(false, Ordering::Release);
            written
        }
        ActorCommand::AccountRosterAttach { window, reply } => {
            *account_roster_window = Some(window);
            if let Err(state) = account_roster_watch_preflight(connection) {
                publish_account_roster_watch_state(
                    account_roster_watch_tx,
                    account_roster_window.as_ref(),
                    state.clone(),
                );
                let _ = reply.send(state);
                return true;
            }
            let watch_live = matches!(
                &*account_roster_watch_tx.borrow(),
                AccountRosterWatchState::Live
            );
            if watch_live {
                let _ = reply.send(AccountRosterWatchState::Live);
                return true;
            }
            account_roster_watch_waiters.push(reply);
            if pending_account_roster_watch.is_some() {
                return true;
            }

            let pending = AccountRosterWatchState::unavailable(
                "The account roster watch is awaiting daemon readiness.",
            );
            publish_account_roster_watch_state(
                account_roster_watch_tx,
                account_roster_window.as_ref(),
                pending,
            );
            match send_account_roster_watch(stream, connection.frame_limit, encoding, next_request)
                .await
            {
                Ok(request_id) => {
                    *pending_account_roster_watch = Some(request_id);
                    true
                }
                Err(error) => {
                    let state = AccountRosterWatchState::unavailable(format!(
                        "Unable to write account.list_watch: {error}"
                    ));
                    publish_account_roster_watch_state(
                        account_roster_watch_tx,
                        account_roster_window.as_ref(),
                        state.clone(),
                    );
                    for reply in account_roster_watch_waiters.drain(..) {
                        let _ = reply.send(state.clone());
                    }
                    false
                }
            }
        }
        ActorCommand::QueueAttach {
            app,
            session_id,
            reply,
        } => {
            subscriptions
                .entry(session_id.clone())
                .and_modify(|subscription| subscription.app = app.clone())
                .or_insert_with(|| Subscription::new(app, &session_id));

            if let Err(error) = queue_watch_preflight(connection) {
                let _ = reply.send(Err(error));
                return true;
            }

            let needs_write = {
                let subscription = subscriptions
                    .get_mut(&session_id)
                    .expect("queue subscription was just installed");
                if subscription.queue_attachment_id.is_some() {
                    let _ = reply.send(Ok(()));
                    return true;
                }
                subscription.queue_watch_waiters.push(reply);
                !subscription.queue_attach_pending
            };
            if !needs_write {
                return true;
            }

            match send_queue_watch(
                stream,
                connection.frame_limit,
                encoding,
                next_request,
                subscriptions,
                pending_queue_attaches,
                session_id.clone(),
            )
            .await
            {
                Ok(()) => true,
                Err(error) => {
                    finish_queue_watch_waiters(
                        subscriptions.get_mut(&session_id),
                        Err(QueueCommandError::unavailable(format!(
                            "Unable to write the live queue watch request: {error}"
                        ))),
                    );
                    false
                }
            }
        }
        ActorCommand::RpcRequest {
            body,
            capability,
            features,
            error_style,
            reply,
        } => {
            if !connection.grants(capability) {
                let _ = reply.send(Some(Err("capability_denied".to_string())));
                return true;
            }
            if !features.is_satisfied_by(&connection.features) {
                let missing = features
                    .unavailable_features(&connection.features)
                    .join(", ");
                let _ = reply.send(Some(Err(format!(
                    "missing_feature: daemon does not advertise {missing}"
                ))));
                return true;
            }
            let request_id = request_id(next_request);
            let request = WireFrame::Request {
                request_id: request_id.clone(),
                body,
            };
            if write_frame(stream, &request, connection.frame_limit, encoding)
                .await
                .is_err()
            {
                let _ = reply.send(None);
                return false;
            }
            pending_requests.insert(request_id, (reply, error_style));
            true
        }
        ActorCommand::DescendantAttach {
            app,
            session_id,
            cursors,
            max_children,
            reply,
        } => {
            if !connection.grants(Capability::View) {
                let _ = reply.send(Err("capability_denied".to_string()));
                return true;
            }
            if !connection
                .features
                .contains(FEATURE_SESSION_DESCENDANT_STREAM_V1)
            {
                let _ = reply.send(Err(format!(
                    "missing_feature: daemon does not advertise {FEATURE_SESSION_DESCENDANT_STREAM_V1}"
                )));
                return true;
            }
            let lost_events_at_attach = DESCENDANT_LOST_EVENTS.load(Ordering::Relaxed);
            let request_id = request_id(next_request);
            let request = WireFrame::Request {
                request_id: request_id.clone(),
                body: session_descendants_attach_request(session_id.clone(), cursors, max_children),
            };
            if write_frame(stream, &request, connection.frame_limit, encoding)
                .await
                .is_err()
            {
                let _ = reply.send(Err(
                    "session.descendants.attach request could not be written".to_string(),
                ));
                return false;
            }
            pending_descendant_attaches.insert(
                request_id,
                PendingDescendantAttach {
                    app,
                    session_id,
                    lost_events_at_attach,
                    reply,
                },
            );
            true
        }
        ActorCommand::DescendantDetach {
            attachment_id,
            reply,
        } => {
            if !connection.grants(Capability::View) {
                let _ = reply.send(Err("capability_denied".to_string()));
                return true;
            }
            if !connection
                .features
                .contains(FEATURE_SESSION_DESCENDANT_STREAM_V1)
            {
                let _ = reply.send(Err(format!(
                    "missing_feature: daemon does not advertise {FEATURE_SESSION_DESCENDANT_STREAM_V1}"
                )));
                return true;
            }
            if !descendant_forwarders.contains(&attachment_id) {
                let _ = reply.send(Err("not_found".to_string()));
                return true;
            }
            let request_id = request_id(next_request);
            let request = WireFrame::Request {
                request_id: request_id.clone(),
                body: RequestBody::SessionDetach {
                    attachment_id: attachment_id.clone(),
                },
            };
            if write_frame(stream, &request, connection.frame_limit, encoding)
                .await
                .is_err()
            {
                let _ = reply.send(Err(
                    "session_descendants_detach request could not be written".to_string(),
                ));
                return false;
            }
            pending_descendant_detaches.insert(
                request_id,
                PendingDescendantDetach {
                    attachment_id,
                    reply,
                },
            );
            true
        }
        ActorCommand::LoomWatch {
            app,
            after_cursor,
            reply,
        } => {
            if !connection.grants(Capability::View) {
                let _ = reply.send(Err(loom_typed_transport_error(
                    "capability_denied".to_string(),
                )));
                return true;
            }
            if !connection.features.contains(FEATURE_LOOM_REGISTRY_WATCH_V1) {
                let _ = reply.send(Err(loom_typed_transport_error(format!(
                    "missing_feature: daemon does not advertise {FEATURE_LOOM_REGISTRY_WATCH_V1}"
                ))));
                return true;
            }
            let request_id = request_id(next_request);
            let request = WireFrame::Request {
                request_id: request_id.clone(),
                body: RequestBody::LoomWatch { after_cursor },
            };
            if write_frame(stream, &request, connection.frame_limit, encoding)
                .await
                .is_err()
            {
                let _ = reply.send(Err(LoomCommandError::unavailable(
                    "loom.watch request could not be written",
                )));
                return false;
            }
            pending_loom_watches.insert(request_id, PendingLoomWatch { app, reply });
            true
        }
        ActorCommand::MenuAnswer {
            command_id,
            session_id,
            menu_id,
            request_seq,
            worker_generation,
            option_key,
            option_index,
            reply,
        } => {
            if !connection.grants(Capability::Control) {
                let _ = reply.send(Some(Err("capability_denied".to_string())));
                return true;
            }
            if !connection.features.contains(FEATURE_SESSION_NEEDS_INPUT_V1) {
                let _ = reply.send(Some(Err(format!(
                    "missing_feature: daemon does not advertise {FEATURE_SESSION_NEEDS_INPUT_V1}"
                ))));
                return true;
            }
            let request_id = request_id(next_request);
            let request = WireFrame::MenuAnswer {
                request_id: Some(request_id.clone()),
                command_id,
                session_id,
                menu_id,
                request_seq,
                worker_generation,
                option_key,
                option_index,
                input: None,
            };
            if write_frame(stream, &request, connection.frame_limit, encoding)
                .await
                .is_err()
            {
                let _ = reply.send(None);
                return false;
            }
            pending_requests.insert(request_id, (reply, RpcErrorStyle::Code));
            true
        }
        ActorCommand::Attach {
            app,
            session_id,
            reply,
        } => {
            subscriptions
                .entry(session_id.clone())
                .and_modify(|subscription| subscription.app = app.clone())
                .or_insert_with(|| Subscription::new(app, &session_id));
            let active = connection.can_watch_surfaces();
            let written = !active
                || send_surface_watch(
                    stream,
                    connection.frame_limit,
                    encoding,
                    next_request,
                    session_id.clone(),
                )
                .await
                .is_ok();
            let queue_written = if written
                && connection.can_watch_queue()
                && subscriptions.get(&session_id).is_some_and(|subscription| {
                    subscription.queue_attachment_id.is_none() && !subscription.queue_attach_pending
                }) {
                send_queue_watch(
                    stream,
                    connection.frame_limit,
                    encoding,
                    next_request,
                    subscriptions,
                    pending_queue_attaches,
                    session_id,
                )
                .await
                .is_ok()
            } else {
                true
            };
            let _ = reply.send(SurfaceCommandStatus::from_connection(
                connection, active, written,
            ));
            written && queue_written
        }
        ActorCommand::Detach { session_id, reply } => {
            subscriptions.remove(&session_id);
            let had_daemon_watch = connection.can_watch_surfaces() || connection.can_watch_queue();
            let _ = reply.send(SurfaceCommandStatus::from_connection(
                connection,
                had_daemon_watch,
                true,
            ));
            // Closing this connection is the protocol-v1 unwatch operation.
            // The outer actor loop immediately reconnects and replays only the
            // subscriptions still present in the map.
            !had_daemon_watch
        }
        ActorCommand::PublishInput {
            session_id,
            text,
            attachments,
            revision,
            reply,
        } => {
            let active = connection.can_publish_input();
            let fresh = last_published_revision
                .get(&session_id)
                .is_none_or(|previous| revision > *previous);
            let written = if active && fresh {
                // Upload may have completed on an older connection. Re-check
                // the actor's current negotiated features immediately before
                // encoding so legacy daemons receive their exact old frame.
                let attachments = attachments_for_current_connection(connection, attachments);
                let request = WireFrame::Request {
                    request_id: request_id(next_request),
                    body: RequestBody::SessionSurfacePublish {
                        session_id: session_id.clone(),
                        input: Some(SurfaceInputPublishWire {
                            text,
                            attachments,
                            revision,
                        }),
                        status: None,
                    },
                };
                write_frame(stream, &request, connection.frame_limit, encoding)
                    .await
                    .is_ok()
            } else {
                false
            };
            if written {
                last_published_revision.insert(session_id, revision);
            }
            let _ = reply.send(SurfaceCommandStatus::from_connection(
                connection, active, written,
            ));
            !active || !fresh || written
        }
    }
}

#[cfg(unix)]
fn emit_surface(
    subscriptions: &mut HashMap<String, Subscription>,
    connection: &ConnectionSnapshot,
    session_id: String,
    input: Option<SurfaceInputWire>,
    status: Option<SurfaceStatusWire>,
) {
    let Some(subscription) = subscriptions.get_mut(&session_id) else {
        return;
    };
    let (input, status) = gated_surface_snapshot(&connection.features, input, status);
    let Some((input, status)) = subscription.revision_gate.accept(input, status) else {
        return;
    };
    let _ = subscription.app.emit(
        SURFACE_EVENT,
        SessionSurfacePayload {
            session_id,
            input,
            status,
        },
    );
}

fn gated_surface_snapshot(
    features: &BTreeSet<String>,
    input: Option<SurfaceInputWire>,
    status: Option<SurfaceStatusWire>,
) -> (Option<SurfaceInputWire>, Option<SurfaceStatusWire>) {
    let input = features
        .contains(FEATURE_INPUT_MIRROR_V1)
        .then_some(input)
        .flatten()
        .map(|mut input| {
            if !features.contains(FEATURE_INPUT_MIRROR_ATTACHMENTS_V1) {
                input.attachments.clear();
            }
            input
        });
    let status = features
        .contains(FEATURE_STATUS_SEGMENT_V1)
        .then_some(status)
        .flatten()
        .map(|mut status| {
            if !features.contains(FEATURE_STATUS_SEGMENT_STRUCTURED_V1) {
                status.state = None;
                status.detail = None;
            }
            status
        });
    (input, status)
}

fn resident_binding_snapshot_for_frame(
    features: &BTreeSet<String>,
    session_id: Option<String>,
    worker_generation: u64,
) -> Option<ResidentSessionBindingSnapshot> {
    features
        .contains(FEATURE_RESIDENT_SESSION_BINDING_V1)
        .then_some(ResidentSessionBindingSnapshot {
            supported: Some(true),
            known: true,
            session_id,
            worker_generation: Some(worker_generation),
        })
}

#[cfg(unix)]
fn response_result(body: ResponseBody, error_style: RpcErrorStyle) -> Result<ResponseBody, String> {
    match body {
        response if matches!(error_style, RpcErrorStyle::Passthrough) => Ok(response),
        ResponseBody::Error { code, .. } if matches!(error_style, RpcErrorStyle::Code) => Err(code),
        ResponseBody::Error { code, data, .. } if matches!(error_style, RpcErrorStyle::Public) => {
            Err(public_rpc_error(code, data))
        }
        ResponseBody::Error {
            code,
            message,
            retryable,
            ..
        } => Err(format!(
            "daemon rejected RPC request ({code}, retryable={retryable}): {message}"
        )),
        response => Ok(response),
    }
}

#[cfg(unix)]
fn public_rpc_error(code: String, data: Option<Value>) -> String {
    if code == "revision_conflict" {
        let expected = data
            .as_ref()
            .and_then(|value| value.get("expected_revision"))
            .and_then(Value::as_u64);
        let current = data
            .as_ref()
            .and_then(|value| value.get("current_revision"))
            .and_then(Value::as_u64);
        if let (Some(expected), Some(current)) = (expected, current) {
            return format!(
                "revision_conflict: expected_revision={expected}, current_revision={current}"
            );
        }
    }
    code
}

fn parse_queue_changed_payload_owned(
    envelope_seq: u64,
    payload: Value,
) -> Result<Option<QueueEventPayloadWire>, String> {
    if payload.get("type").and_then(Value::as_str).is_none() {
        return Ok(None);
    }
    let delta: QueueEventPayloadWire = serde_json::from_value(payload)
        .map_err(|error| format!("invalid QueueChanged payload: {error}"))?;
    let QueueEventPayloadWire::QueueChanged { revision, change } = &delta else {
        return Ok(None);
    };
    if *revision != envelope_seq {
        return Err(format!(
            "QueueChanged revision {} did not match envelope sequence {envelope_seq}",
            revision
        ));
    }
    match change {
        QueueChangeWire::Enqueued { row } => {
            if row.id.is_empty() || row.ordinal == 0 {
                return Err("QueueChanged enqueued row had an invalid id or ordinal".to_string());
            }
        }
        QueueChangeWire::Removed { id }
        | QueueChangeWire::PromotedSteer { id }
        | QueueChangeWire::Consumed { id } => {
            if id.is_empty() {
                return Err("QueueChanged removal had an empty id".to_string());
            }
        }
        QueueChangeWire::Unknown => {
            return Err("QueueChanged carried an unknown change kind".to_string());
        }
    }
    Ok(Some(delta))
}

#[cfg(test)]
fn parse_queue_changed_payload(
    envelope_seq: u64,
    payload: &Value,
) -> Result<Option<QueueEventPayloadWire>, String> {
    parse_queue_changed_payload_owned(envelope_seq, payload.clone())
}

#[cfg(unix)]
fn emit_queue_watch_failure_for_session(
    subscription: &Subscription,
    session_id: &str,
    reason: &str,
    gap: bool,
) {
    let _ = subscription.app.emit(
        SESSION_QUEUE_CHANGED_EVENT,
        serde_json::json!({
            "session_id": session_id,
            "watch_failed": !gap,
            "gap": gap,
            "type": if gap { "lagged" } else { "queue_watch_failed" },
            "reason": reason,
        }),
    );
}

#[cfg(unix)]
fn finish_queue_watch_waiters(
    subscription: Option<&mut Subscription>,
    result: Result<(), QueueCommandError>,
) {
    let Some(subscription) = subscription else {
        return;
    };
    for reply in subscription.queue_watch_waiters.drain(..) {
        let _ = reply.send(result.clone());
    }
}

#[cfg(unix)]
fn finish_queue_watch(
    subscriptions: &mut HashMap<String, Subscription>,
    expected_session_id: String,
    body: ResponseBody,
) {
    let Some(subscription) = subscriptions.get_mut(&expected_session_id) else {
        return;
    };
    subscription.queue_attach_pending = false;
    match body {
        ResponseBody::SessionAttach {
            attachment_id,
            attach_state,
        } if attach_state.session_id == expected_session_id => {
            subscription.queue_cursor = subscription
                .queue_cursor
                .max(attach_state.requested_after_seq);
            subscription.queue_attachment_id = Some(attachment_id);
            finish_queue_watch_waiters(Some(subscription), Ok(()));
        }
        ResponseBody::Error {
            code,
            message,
            retryable,
            data,
        } => {
            eprintln!("[ade-rpc] queue watch failed for {expected_session_id}: {message}");
            emit_queue_watch_failure_for_session(
                subscription,
                &expected_session_id,
                &message,
                false,
            );
            finish_queue_watch_waiters(
                Some(subscription),
                Err(QueueCommandError::from_daemon(
                    code, message, retryable, data,
                )),
            );
        }
        _ => {
            let reason = "session.attach returned a malformed queue watch response";
            eprintln!("[ade-rpc] {reason} for {expected_session_id}");
            emit_queue_watch_failure_for_session(subscription, &expected_session_id, reason, false);
            finish_queue_watch_waiters(
                Some(subscription),
                Err(QueueCommandError::protocol(reason)),
            );
        }
    }
}

#[cfg(unix)]
fn handle_queue_event(
    subscriptions: &mut HashMap<String, Subscription>,
    attachment_id: String,
    frame_session_id: String,
    envelope: RawEnvelopeWire,
) -> bool {
    let Some((expected_session_id, subscription)) =
        subscriptions.iter_mut().find(|(_, subscription)| {
            subscription.queue_attachment_id.as_deref() == Some(attachment_id.as_str())
        })
    else {
        return true;
    };
    if frame_session_id.as_str() != expected_session_id.as_str()
        || envelope.session_id.as_str() != expected_session_id.as_str()
    {
        let reason = "queue event session did not match its attachment";
        eprintln!("[ade-rpc] dropping malformed QueueChanged: {reason}");
        emit_queue_watch_failure_for_session(subscription, &expected_session_id, reason, false);
        return true;
    }
    if envelope.seq <= subscription.queue_cursor {
        return true;
    }
    if envelope.seq != subscription.queue_cursor.saturating_add(1) {
        let reason = format!(
            "queue watch sequence gap after {} before {}",
            subscription.queue_cursor, envelope.seq
        );
        eprintln!("[ade-rpc] {reason}");
        emit_queue_watch_failure_for_session(subscription, &expected_session_id, &reason, true);
        return false;
    }

    let parsed = parse_queue_changed_payload_owned(envelope.seq, envelope.payload);
    subscription.queue_cursor = envelope.seq;
    match parsed {
        Ok(Some(payload)) => {
            let _ = subscription.app.emit(
                SESSION_QUEUE_CHANGED_EVENT,
                SessionQueueChangedPayload {
                    session_id: frame_session_id,
                    envelope: QueueEventEnvelopePayload {
                        seq: envelope.seq,
                        payload,
                    },
                },
            );
        }
        Ok(None) => {}
        Err(error) => {
            eprintln!("[ade-rpc] dropping malformed QueueChanged: {error}");
        }
    }
    true
}

#[cfg(unix)]
fn emit_queue_stream_gap(
    subscriptions: &HashMap<String, Subscription>,
    attachment_id: &str,
) -> bool {
    let Some((session_id, subscription)) = subscriptions.iter().find(|(_, subscription)| {
        subscription.queue_attachment_id.as_deref() == Some(attachment_id)
    }) else {
        return false;
    };
    emit_queue_watch_failure_for_session(
        subscription,
        session_id,
        "The daemon dropped the session queue attachment.",
        true,
    );
    true
}

#[cfg(unix)]
async fn send_roster_watch(
    stream: &mut UnixStream,
    frame_limit: usize,
    encoding: WireEncoding,
    next_request: &mut u64,
) -> std::io::Result<()> {
    let request = WireFrame::Request {
        request_id: request_id(next_request),
        body: RequestBody::SessionListWatch {},
    };
    write_frame(stream, &request, frame_limit, encoding).await
}

#[cfg(unix)]
async fn send_account_roster_watch(
    stream: &mut UnixStream,
    frame_limit: usize,
    encoding: WireEncoding,
    next_request: &mut u64,
) -> std::io::Result<String> {
    let request_id = request_id(next_request);
    let request = WireFrame::Request {
        request_id: request_id.clone(),
        body: RequestBody::AccountListWatch {},
    };
    write_frame(stream, &request, frame_limit, encoding).await?;
    Ok(request_id)
}

#[cfg(unix)]
async fn send_queue_watch(
    stream: &mut UnixStream,
    frame_limit: usize,
    encoding: WireEncoding,
    next_request: &mut u64,
    subscriptions: &mut HashMap<String, Subscription>,
    pending_queue_attaches: &mut HashMap<String, String>,
    session_id: String,
) -> std::io::Result<()> {
    let Some(after_seq) = subscriptions
        .get(&session_id)
        .map(|subscription| subscription.queue_cursor)
    else {
        return Ok(());
    };
    let request_id = request_id(next_request);
    let request = WireFrame::Request {
        request_id: request_id.clone(),
        body: RequestBody::SessionAttach {
            session_id: session_id.clone(),
            after_seq,
            mode: AttachMode::Control,
            sealed_replay: false,
        },
    };
    write_frame(stream, &request, frame_limit, encoding).await?;
    if let Some(subscription) = subscriptions.get_mut(&session_id) {
        subscription.queue_attach_pending = true;
    }
    pending_queue_attaches.insert(request_id, session_id);
    Ok(())
}

#[cfg(unix)]
async fn send_surface_watch(
    stream: &mut UnixStream,
    frame_limit: usize,
    encoding: WireEncoding,
    next_request: &mut u64,
    session_id: String,
) -> std::io::Result<()> {
    let request = WireFrame::Request {
        request_id: request_id(next_request),
        body: RequestBody::SessionSurfaceWatch { session_id },
    };
    write_frame(stream, &request, frame_limit, encoding).await
}

#[cfg(unix)]
fn request_id(next_request: &mut u64) -> String {
    let request_id = format!("diffforge-ade-{}", *next_request);
    *next_request = next_request.saturating_add(1);
    request_id
}

#[cfg(unix)]
async fn connect_and_handshake(path: &Path) -> std::io::Result<(UnixStream, Welcome)> {
    let stream = UnixStream::connect(path).await?;
    handshake_connected_stream_for_profile(stream, expected_profile_id().as_deref()).await
}

#[cfg(unix)]
async fn handshake_connected_stream(stream: UnixStream) -> std::io::Result<(UnixStream, Welcome)> {
    handshake_connected_stream_for_profile(stream, None).await
}

#[cfg(unix)]
async fn handshake_connected_stream_for_profile(
    mut stream: UnixStream,
    expected_profile_id: Option<&str>,
) -> std::io::Result<(UnixStream, Welcome)> {
    write_frame(
        &mut stream,
        &hello_frame(),
        DEFAULT_FRAME_LIMIT,
        WireEncoding::Json,
    )
    .await?;
    let welcome = match read_frame(&mut stream, DEFAULT_FRAME_LIMIT).await? {
        WireFrame::Welcome(welcome) => welcome,
        WireFrame::ProtocolError(error) => {
            return Err(invalid_data(format!(
                "Haider handshake rejected ({}): {}",
                error.code, error.message
            )));
        }
        frame => {
            return Err(invalid_data(format!(
                "first Haider daemon frame was {}; expected Welcome",
                wire_frame_kind(&frame)
            )));
        }
    };
    if welcome.protocol != WIRE_PROTOCOL_VERSION || welcome.frame_limit == 0 {
        return Err(invalid_data("invalid Haider Welcome negotiation"));
    }
    if !welcome.profile_id.is_empty()
        && expected_profile_id.is_some_and(|expected| expected != welcome.profile_id.as_str())
    {
        return Err(invalid_data("Haider Welcome profile_id mismatch"));
    }
    WireEncoding::from_welcome(&welcome)?;
    Ok((stream, welcome))
}

#[cfg(unix)]
fn wire_frame_kind(frame: &WireFrame) -> &'static str {
    match frame {
        WireFrame::Hello(_) => "hello",
        WireFrame::Welcome(_) => "welcome",
        WireFrame::Request { .. } => "request",
        WireFrame::Response { .. } => "response",
        WireFrame::Event { .. } => "event",
        WireFrame::AttachCaughtUp { .. } => "attach_caught_up",
        WireFrame::SessionRosterDelta { .. } => "session_roster_delta",
        WireFrame::AccountsChanged { .. } => "accounts_changed",
        WireFrame::SessionSurfaceDelta { .. } => "session_surface_delta",
        WireFrame::HaiderCodePlanStatus { .. } => "haider_code_plan_status",
        WireFrame::ResidentSessionBinding { .. } => "resident_session_binding",
        WireFrame::MonitorDelivery { .. } => "monitor_delivery",
        WireFrame::MonitorDeliveryCaughtUp { .. } => "monitor_delivery_caught_up",
        WireFrame::LoomRegistryDelta { .. } => "loom_registry_delta",
        WireFrame::LoomRegistryCaughtUp { .. } => "loom_registry_caught_up",
        WireFrame::SessionDescendantStream { .. } => "session_descendant_stream",
        WireFrame::SessionDescendantRepairRequired { .. } => "session_descendant_repair_required",
        WireFrame::MenuAnswer { .. } => "menu_answer",
        WireFrame::Ping { .. } => "ping",
        WireFrame::Pong { .. } => "pong",
        WireFrame::Lagged { .. } => "lagged",
        WireFrame::ProtocolError(_) => "protocol_error",
        WireFrame::Unknown => "unknown",
    }
}

#[cfg(unix)]
async fn write_frame(
    stream: &mut UnixStream,
    frame: &WireFrame,
    frame_limit: usize,
    encoding: WireEncoding,
) -> std::io::Result<()> {
    let mut bytes = encode_framed_with_encoding(frame, frame_limit, encoding)?;
    let write = stream.write_all(&bytes).await;
    bytes.zeroize();
    write
}

#[cfg(unix)]
async fn read_frame(stream: &mut UnixStream, frame_limit: usize) -> std::io::Result<WireFrame> {
    let mut prefix = [0_u8; 4];
    stream.read_exact(&mut prefix).await?;
    let body_len = u32::from_be_bytes(prefix) as usize;
    if body_len == 0 || body_len > frame_limit {
        return Err(invalid_data("invalid Haider UDS length prefix"));
    }
    let mut body = vec![0_u8; body_len];
    stream.read_exact(&mut body).await?;
    decode_body(&body, frame_limit)
}

/// Resolves only the deterministic endpoint published by the client
/// contract. Directory scanning can silently connect this profile to a
/// different daemon and is therefore never a compatibility fallback.
pub(crate) fn resolve_socket_path() -> Option<PathBuf> {
    #[cfg(unix)]
    {
        let uid = unsafe { libc::geteuid() };
        let runtime_dir = runtime_dir(uid);
        deterministic_endpoint(
            std::env::var_os("HAIDER_PROFILE_DIR")
                .as_deref()
                .map(Path::new),
            std::env::var_os("HOME").as_deref().map(Path::new),
            &runtime_dir,
        )
    }
    #[cfg(not(unix))]
    None
}

#[cfg(unix)]
fn runtime_dir(uid: u32) -> PathBuf {
    #[cfg(target_os = "linux")]
    {
        if let Some(xdg) = std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from) {
            if is_owner_private_directory(&xdg, uid) {
                return xdg.join("haider");
            }
        }
    }
    PathBuf::from("/tmp").join(format!("haider-{uid}"))
}

#[cfg(target_os = "linux")]
fn is_owner_private_directory(path: &Path, uid: u32) -> bool {
    use std::os::unix::fs::MetadataExt;

    std::fs::symlink_metadata(path).is_ok_and(|metadata| {
        metadata.is_dir() && metadata.uid() == uid && metadata.mode() & 0o777 == 0o700
    })
}

fn deterministic_endpoint(
    profile_dir: Option<&Path>,
    home: Option<&Path>,
    runtime_dir: &Path,
) -> Option<PathBuf> {
    let store_dir = match profile_dir {
        Some(path) => path.to_owned(),
        None => home
            .filter(|path| !path.as_os_str().is_empty())?
            .join(".haider")
            .join("dev-profile"),
    };
    let absolute = if store_dir.is_absolute() {
        store_dir
    } else {
        std::env::current_dir().ok()?.join(store_dir)
    };
    std::fs::create_dir_all(&absolute).ok()?;
    let canonical = absolute.canonicalize().ok()?;
    let canonical_text = canonical.to_str()?;

    let mut profile_material = Vec::with_capacity(PROFILE_ID_TAG.len() + canonical_text.len());
    profile_material.extend_from_slice(PROFILE_ID_TAG);
    profile_material.extend_from_slice(canonical_text.as_bytes());
    let profile_id = hex(&blake3_hash(&profile_material));
    let endpoint_digest = hex(&blake3_hash(profile_id.as_bytes()));
    Some(runtime_dir.join(format!("haider-{}.sock", &endpoint_digest[..32])))
}

pub(crate) fn expected_profile_id() -> Option<String> {
    let profile_dir = std::env::var_os("HAIDER_PROFILE_DIR");
    let home = std::env::var_os("HOME");
    let store_dir = match profile_dir.as_deref().map(Path::new) {
        Some(path) => path.to_owned(),
        None => home
            .as_deref()
            .map(Path::new)
            .filter(|path| !path.as_os_str().is_empty())?
            .join(".haider")
            .join("dev-profile"),
    };
    let absolute = if store_dir.is_absolute() {
        store_dir
    } else {
        std::env::current_dir().ok()?.join(store_dir)
    };
    std::fs::create_dir_all(&absolute).ok()?;
    let canonical = absolute.canonicalize().ok()?;
    let canonical_text = canonical.to_str()?;
    let mut material = Vec::with_capacity(PROFILE_ID_TAG.len() + canonical_text.len());
    material.extend_from_slice(PROFILE_ID_TAG);
    material.extend_from_slice(canonical_text.as_bytes());
    Some(hex(&blake3_hash(&material)))
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for &byte in bytes {
        encoded.push(DIGITS[(byte >> 4) as usize] as char);
        encoded.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    encoded
}

// Compact, dependency-free BLAKE3 implementation. Profile paths can be any
// length; the tree reduction follows the reference hasher's left-CV stack.
const BLAKE3_IV: [u32; 8] = [
    0x6A09_E667,
    0xBB67_AE85,
    0x3C6E_F372,
    0xA54F_F53A,
    0x510E_527F,
    0x9B05_688C,
    0x1F83_D9AB,
    0x5BE0_CD19,
];
const CHUNK_START: u32 = 1;
const CHUNK_END: u32 = 2;
const PARENT: u32 = 4;
const ROOT: u32 = 8;

#[derive(Clone, Copy)]
struct Blake3Output {
    input_cv: [u32; 8],
    block_words: [u32; 16],
    counter: u64,
    block_len: u32,
    flags: u32,
}

impl Blake3Output {
    fn chaining_value(self) -> [u32; 8] {
        let words = blake3_compress(
            self.input_cv,
            self.block_words,
            self.counter,
            self.block_len,
            self.flags,
        );
        words[..8].try_into().expect("fixed BLAKE3 CV length")
    }

    fn root_hash(self) -> [u8; 32] {
        let words = blake3_compress(
            self.input_cv,
            self.block_words,
            0,
            self.block_len,
            self.flags | ROOT,
        );
        let mut hash = [0_u8; 32];
        for (destination, word) in hash.chunks_exact_mut(4).zip(words[..8].iter()) {
            destination.copy_from_slice(&word.to_le_bytes());
        }
        hash
    }
}

fn blake3_hash(input: &[u8]) -> [u8; 32] {
    let chunk_count = input.len().div_ceil(1024).max(1);
    let mut cv_stack: Vec<[u32; 8]> = Vec::new();

    for chunk_index in 0..chunk_count.saturating_sub(1) {
        let start = chunk_index * 1024;
        let mut cv = chunk_output(&input[start..start + 1024], chunk_index as u64).chaining_value();
        let mut total_chunks = chunk_index + 1;
        while total_chunks & 1 == 0 {
            let left = cv_stack.pop().expect("BLAKE3 tree has a left CV");
            cv = parent_output(left, cv).chaining_value();
            total_chunks >>= 1;
        }
        cv_stack.push(cv);
    }

    let last_index = chunk_count - 1;
    let last_start = last_index * 1024;
    let mut output = chunk_output(&input[last_start..], last_index as u64);
    while let Some(left) = cv_stack.pop() {
        output = parent_output(left, output.chaining_value());
    }
    output.root_hash()
}

fn chunk_output(chunk: &[u8], chunk_counter: u64) -> Blake3Output {
    debug_assert!(chunk.len() <= 1024);
    let mut cv = BLAKE3_IV;
    let mut offset = 0;
    let mut block_index = 0;
    while chunk.len().saturating_sub(offset) > 64 {
        let words = block_words(&chunk[offset..offset + 64]);
        let flags = if block_index == 0 { CHUNK_START } else { 0 };
        let compressed = blake3_compress(cv, words, chunk_counter, 64, flags);
        cv.copy_from_slice(&compressed[..8]);
        offset += 64;
        block_index += 1;
    }

    let final_block = &chunk[offset..];
    Blake3Output {
        input_cv: cv,
        block_words: block_words(final_block),
        counter: chunk_counter,
        block_len: final_block.len() as u32,
        flags: CHUNK_END | if block_index == 0 { CHUNK_START } else { 0 },
    }
}

fn parent_output(left: [u32; 8], right: [u32; 8]) -> Blake3Output {
    let mut block = [0_u32; 16];
    block[..8].copy_from_slice(&left);
    block[8..].copy_from_slice(&right);
    Blake3Output {
        input_cv: BLAKE3_IV,
        block_words: block,
        counter: 0,
        block_len: 64,
        flags: PARENT,
    }
}

fn block_words(block: &[u8]) -> [u32; 16] {
    let mut padded = [0_u8; 64];
    padded[..block.len()].copy_from_slice(block);
    let mut words = [0_u32; 16];
    for (word, bytes) in words.iter_mut().zip(padded.chunks_exact(4)) {
        *word = u32::from_le_bytes(bytes.try_into().expect("four-byte BLAKE3 word"));
    }
    words
}

fn blake3_compress(
    cv: [u32; 8],
    mut message: [u32; 16],
    counter: u64,
    block_len: u32,
    flags: u32,
) -> [u32; 16] {
    let mut state = [0_u32; 16];
    state[..8].copy_from_slice(&cv);
    state[8..12].copy_from_slice(&BLAKE3_IV[..4]);
    state[12] = counter as u32;
    state[13] = (counter >> 32) as u32;
    state[14] = block_len;
    state[15] = flags;

    for _ in 0..7 {
        blake3_round(&mut state, &message);
        message = [
            message[2],
            message[6],
            message[3],
            message[10],
            message[7],
            message[0],
            message[4],
            message[13],
            message[1],
            message[11],
            message[12],
            message[5],
            message[9],
            message[14],
            message[15],
            message[8],
        ];
    }

    let mut output = [0_u32; 16];
    for index in 0..8 {
        output[index] = state[index] ^ state[index + 8];
        output[index + 8] = state[index + 8] ^ cv[index];
    }
    output
}

fn blake3_round(state: &mut [u32; 16], message: &[u32; 16]) {
    blake3_g(state, 0, 4, 8, 12, message[0], message[1]);
    blake3_g(state, 1, 5, 9, 13, message[2], message[3]);
    blake3_g(state, 2, 6, 10, 14, message[4], message[5]);
    blake3_g(state, 3, 7, 11, 15, message[6], message[7]);
    blake3_g(state, 0, 5, 10, 15, message[8], message[9]);
    blake3_g(state, 1, 6, 11, 12, message[10], message[11]);
    blake3_g(state, 2, 7, 8, 13, message[12], message[13]);
    blake3_g(state, 3, 4, 9, 14, message[14], message[15]);
}

fn blake3_g(state: &mut [u32; 16], a: usize, b: usize, c: usize, d: usize, x: u32, y: u32) {
    state[a] = state[a].wrapping_add(state[b]).wrapping_add(x);
    state[d] = (state[d] ^ state[a]).rotate_right(16);
    state[c] = state[c].wrapping_add(state[d]);
    state[b] = (state[b] ^ state[c]).rotate_right(12);
    state[a] = state[a].wrapping_add(state[b]).wrapping_add(y);
    state[d] = (state[d] ^ state[a]).rotate_right(8);
    state[c] = state[c].wrapping_add(state[d]);
    state[b] = (state[b] ^ state[c]).rotate_right(7);
}

#[cfg(test)]
#[path = "haider_rpc_ade_loom_tests.rs"]
mod loom_tests;

#[cfg(test)]
#[allow(clippy::expect_used)]
#[path = "haider_rpc_ade_loom_p5_tests.rs"]
mod loom_p5_tests;

#[cfg(test)]
#[allow(clippy::expect_used)]
#[path = "haider_rpc_ade_workflow_tests.rs"]
mod workflow_tests;

#[cfg(test)]
#[allow(clippy::expect_used)]
#[path = "haider_rpc_ade_fleet_tests.rs"]
mod fleet_tests;

#[cfg(test)]
#[allow(clippy::expect_used)]
#[path = "haider_rpc_ade_graph_tests.rs"]
mod graph_tests;

#[cfg(test)]
#[allow(clippy::expect_used)]
#[path = "haider_rpc_ade_monitor_tests.rs"]
mod monitor_tests;

#[cfg(test)]
#[allow(clippy::expect_used)]
#[path = "haider_rpc_ade_descendant_tests.rs"]
mod descendant_tests;

#[cfg(test)]
#[allow(clippy::expect_used)]
#[path = "haider_rpc_ade_lifecycle_tests.rs"]
mod lifecycle_tests;

#[cfg(test)]
#[allow(clippy::expect_used)]
#[path = "haider_rpc_ade_checkpoint_tests.rs"]
mod checkpoint_tests;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn haider_code_plan_status_frame_preserves_optional_allowance_fields() {
        let frame: WireFrame = serde_json::from_value(serde_json::json!({
            "kind": "haider_code_plan_status",
            "provider": "haider-code",
            "account_alias": "work",
            "outcome": {
                "state": "available",
                "snapshot": {
                    "weekly_allowance": {
                        "percent_remaining": null,
                        "state": "grace",
                        "resets_at_ms": null,
                        "grace_until_ms": 1_800_000_000_000_u64
                    }
                }
            }
        }))
        .expect("decode provider-authored plan status frame");

        let WireFrame::HaiderCodePlanStatus {
            provider,
            account_alias,
            outcome,
        } = frame
        else {
            panic!("expected haider_code_plan_status frame");
        };
        assert_eq!(provider, "haider-code");
        assert_eq!(account_alias, "work");
        assert!(outcome["snapshot"]["weekly_allowance"]["percent_remaining"].is_null());
        assert_eq!(
            outcome["snapshot"]["weekly_allowance"]["state"],
            serde_json::json!("grace")
        );
        assert_eq!(
            outcome["snapshot"]["weekly_allowance"]["grace_until_ms"],
            serde_json::json!(1_800_000_000_000_u64)
        );
    }

    #[test]
    fn haider_code_plan_status_support_does_not_fabricate_a_snapshot() {
        let supported = BTreeSet::from([FEATURE_HAIDER_CODE_PLAN_STATUS_V1.to_string()]);
        let first = HaiderCodePlanStatusSnapshot::for_features(
            &supported,
            &HaiderCodePlanStatusSnapshot::default(),
        );
        assert_eq!(first.supported, Some(true));
        assert!(!first.known);
        assert_eq!(first.outcome, None);

        let published = HaiderCodePlanStatusSnapshot {
            supported: Some(true),
            known: true,
            provider: Some("haider-code".to_string()),
            account_alias: Some("work".to_string()),
            outcome: Some(serde_json::json!({
                "state": "available",
                "snapshot": { "weekly_allowance": { "percent_remaining": 37.5 } }
            })),
            received_at_ms: Some(123),
        };
        assert_eq!(
            HaiderCodePlanStatusSnapshot::for_features(&supported, &published),
            published,
            "a reconnect that still advertises the feature must retain the last provider frame"
        );

        let unsupported = HaiderCodePlanStatusSnapshot::for_features(&BTreeSet::new(), &published);
        assert_eq!(unsupported.supported, Some(false));
        assert!(!unsupported.known);
        assert_eq!(unsupported.outcome, None);
    }

    #[cfg(unix)]
    #[test]
    fn connection_snapshot_publication_is_durable_without_an_active_receiver() {
        let (connection_tx, initial_receiver) = watch::channel(ConnectionSnapshot::default());
        drop(initial_receiver);
        let expected_feature = FEATURE_PROVIDER_MANAGEMENT_V1.to_string();
        let snapshot = ConnectionSnapshot {
            connected: true,
            roster_identity: Some(RosterConnectionIdentity {
                profile_id: "profile-test".to_string(),
                daemon_generation: 7,
                connection_serial: 1,
            }),
            features: BTreeSet::from([expected_feature.clone()]),
            ..ConnectionSnapshot::default()
        };

        publish_connection(&connection_tx, snapshot);

        assert!(connection_tx.borrow().connected);
        assert!(connection_tx.borrow().features.contains(&expected_feature));

        publish_disconnected(&connection_tx);
        assert!(!connection_tx.borrow().connected);
        assert_eq!(connection_tx.borrow().roster_identity, None);
    }

    #[test]
    fn frame_encode_decode_round_trip_uses_big_endian_json_prefix() {
        let hello = hello_frame();
        let framed = encode_framed(&hello, DEFAULT_FRAME_LIMIT).expect("encode Hello");
        let announced = u32::from_be_bytes(framed[..4].try_into().expect("length prefix"));
        assert_eq!(announced as usize, framed.len() - 4);
        assert_eq!(
            decode_body(&framed[4..], DEFAULT_FRAME_LIMIT).expect("decode Hello"),
            hello
        );
        let hello_json: Value = serde_json::from_slice(&framed[4..]).expect("Hello JSON");
        assert_eq!(hello_json["v"], 1);
        assert_eq!(hello_json["kind"], "hello");
        assert_eq!(hello_json["client_kind"], "gui");
        assert_eq!(
            hello_json["capabilities_requested"],
            serde_json::json!(["view", "control"])
        );
        assert_eq!(hello_json["encodings"], serde_json::json!(["msgpack"]));

        let welcome = WireFrame::Welcome(Welcome {
            protocol: 1,
            instance_id: "daemon-test".to_owned(),
            daemon_generation: 7,
            frame_limit: 1_048_576,
            profile_id: "profile-test".to_owned(),
            daemon_version: "0.0.933".to_owned(),
            lifecycle_phase: "ready".to_owned(),
            capabilities_granted: BTreeSet::from([Capability::View, Capability::Control]),
            features: BTreeSet::from([
                FEATURE_INPUT_MIRROR_V1.to_owned(),
                FEATURE_STATUS_SEGMENT_V1.to_owned(),
            ]),
            encoding: None,
        });
        let framed = encode_framed(&welcome, DEFAULT_FRAME_LIMIT).expect("encode Welcome");
        assert_eq!(
            decode_body(&framed[4..], DEFAULT_FRAME_LIMIT).expect("decode Welcome"),
            welcome
        );
    }

    #[test]
    fn msgpack_negotiation_and_json_fallback_are_tolerant() {
        let hello = hello_frame();
        let hello_json = serde_json::to_value(versioned(hello)).unwrap();
        assert_eq!(hello_json["encodings"], serde_json::json!(["msgpack"]));

        let mut welcome = Welcome {
            protocol: 1,
            instance_id: "daemon-test".to_owned(),
            daemon_generation: 7,
            frame_limit: 1_048_576,
            profile_id: String::new(),
            daemon_version: String::new(),
            lifecycle_phase: "ready".to_owned(),
            capabilities_granted: BTreeSet::new(),
            features: BTreeSet::new(),
            encoding: Some("msgpack".to_owned()),
        };
        assert_eq!(
            WireEncoding::from_welcome(&welcome).unwrap(),
            WireEncoding::Msgpack
        );
        welcome.encoding = None;
        assert_eq!(
            WireEncoding::from_welcome(&welcome).unwrap(),
            WireEncoding::Json
        );
    }

    #[test]
    fn msgpack_frames_round_trip_as_named_maps_and_ignore_extra_fields() {
        let frame = WireFrame::Request {
            request_id: "req-msgpack".to_owned(),
            body: RequestBody::SessionSurfacePublish {
                session_id: "session-1".to_owned(),
                input: Some(SurfaceInputPublishWire {
                    text: "hello".to_owned(),
                    attachments: Vec::new(),
                    revision: 3,
                }),
                status: None,
            },
        };
        let json = encode_framed(&frame, DEFAULT_FRAME_LIMIT).unwrap();
        let msgpack =
            encode_framed_with_encoding(&frame, DEFAULT_FRAME_LIMIT, WireEncoding::Msgpack)
                .unwrap();
        assert_eq!(
            decode_body(&json[4..], DEFAULT_FRAME_LIMIT).unwrap(),
            decode_body_with_encoding(&msgpack[4..], DEFAULT_FRAME_LIMIT, WireEncoding::Msgpack)
                .unwrap()
        );

        let mut future = serde_json::to_value(versioned(frame.clone())).unwrap();
        future
            .as_object_mut()
            .unwrap()
            .insert("future_field".to_owned(), serde_json::json!({"safe": true}));
        let future = rmp_serde::to_vec_named(&future).unwrap();
        assert_eq!(
            decode_body_with_encoding(&future, DEFAULT_FRAME_LIMIT, WireEncoding::Msgpack).unwrap(),
            frame
        );
    }

    #[test]
    fn streaming_decoder_emits_a_partial_frame_once() {
        let frame = WireFrame::Ping { nonce: 42 };
        let bytes = encode_framed(&frame, DEFAULT_FRAME_LIMIT).unwrap();
        let mut decoder = StreamingFrameDecoder::default();
        decoder.push(&bytes[..3]);
        assert!(decoder
            .next(DEFAULT_FRAME_LIMIT, WireEncoding::Json)
            .unwrap()
            .is_none());
        decoder.push(&bytes[3..]);
        assert_eq!(
            decoder
                .next(DEFAULT_FRAME_LIMIT, WireEncoding::Json)
                .unwrap(),
            Some(frame)
        );
        assert!(decoder
            .next(DEFAULT_FRAME_LIMIT, WireEncoding::Json)
            .unwrap()
            .is_none());
    }

    #[test]
    fn streaming_decoder_keeps_bytes_across_cancelled_read_iterations() {
        let frame = WireFrame::Pong { nonce: 99 };
        let bytes = encode_framed_with_encoding(&frame, DEFAULT_FRAME_LIMIT, WireEncoding::Msgpack)
            .unwrap();
        let mut decoder = StreamingFrameDecoder::default();
        // The first chunk stands in for a read completed before another
        // select! branch wins. The owned decoder retains it for the retry.
        decoder.push(&bytes[..6]);
        assert!(decoder
            .next(DEFAULT_FRAME_LIMIT, WireEncoding::Msgpack)
            .unwrap()
            .is_none());
        decoder.push(&bytes[6..]);
        assert_eq!(
            decoder
                .next(DEFAULT_FRAME_LIMIT, WireEncoding::Msgpack)
                .unwrap(),
            Some(frame)
        );
    }

    #[test]
    fn surface_watch_and_publish_frames_match_reference_json_bytes() {
        let watch = WireFrame::Request {
            request_id: "req-watch".to_owned(),
            body: RequestBody::SessionSurfaceWatch {
                session_id: "session-1".to_owned(),
            },
        };
        let framed = encode_framed(&watch, DEFAULT_FRAME_LIMIT).expect("encode surface watch");
        assert_eq!(
            std::str::from_utf8(&framed[4..]).expect("watch JSON"),
            r#"{"v":1,"kind":"request","request_id":"req-watch","body":{"method":"session.surface_watch","session_id":"session-1"}}"#
        );

        let publish = WireFrame::Request {
            request_id: "req-publish".to_owned(),
            body: RequestBody::SessionSurfacePublish {
                session_id: "session-1".to_owned(),
                input: Some(SurfaceInputPublishWire {
                    text: "full composer text".to_owned(),
                    attachments: Vec::new(),
                    revision: 8,
                }),
                status: None,
            },
        };
        let framed = encode_framed(&publish, DEFAULT_FRAME_LIMIT).expect("encode surface publish");
        assert_eq!(
            std::str::from_utf8(&framed[4..]).expect("publish JSON"),
            r#"{"v":1,"kind":"request","request_id":"req-publish","body":{"method":"session.surface_publish","session_id":"session-1","input":{"text":"full composer text","revision":8}}}"#
        );
        assert_eq!(
            u32::from_be_bytes(framed[..4].try_into().expect("publish prefix")) as usize,
            framed.len() - 4
        );

        let attached_publish = WireFrame::Request {
            request_id: "req-publish-attachments".to_owned(),
            body: RequestBody::SessionSurfacePublish {
                session_id: "session-1".to_owned(),
                input: Some(SurfaceInputPublishWire {
                    text: "full composer text".to_owned(),
                    attachments: vec![SurfaceAttachmentWire {
                        mime: "image/png".to_owned(),
                        bytes: 2,
                        artifact: "blake3:paste-image".to_owned(),
                    }],
                    revision: 9,
                }),
                status: None,
            },
        };
        let framed =
            encode_framed(&attached_publish, DEFAULT_FRAME_LIMIT).expect("encode attached publish");
        assert_eq!(
            std::str::from_utf8(&framed[4..]).expect("attached publish JSON"),
            r#"{"v":1,"kind":"request","request_id":"req-publish-attachments","body":{"method":"session.surface_publish","session_id":"session-1","input":{"text":"full composer text","attachments":[{"mime":"image/png","bytes":2,"artifact":"blake3:paste-image"}],"revision":9}}}"#
        );
    }

    #[test]
    fn session_read_frames_match_the_inclusive_raw_envelope_contract() {
        let request = WireFrame::Request {
            request_id: "req-session-read".to_owned(),
            body: RequestBody::SessionRead {
                session_id: "session-1".to_owned(),
                range: SessionReadRange {
                    start_seq: 1,
                    end_seq: 500,
                },
            },
        };
        let framed = encode_framed(&request, DEFAULT_FRAME_LIMIT).expect("encode session.read");
        assert_eq!(
            std::str::from_utf8(&framed[4..]).expect("session.read JSON"),
            r#"{"v":1,"kind":"request","request_id":"req-session-read","body":{"method":"session.read","session_id":"session-1","range":{"start_seq":1,"end_seq":500}}}"#
        );

        let response = br#"{"v":1,"kind":"response","request_id":"req-session-read","body":{"method":"session.read","result":{"session_id":"session-1","range":{"start_seq":1,"end_seq":500},"head_seq":724,"metadata":{"model":"gpt-5"},"latest_context_footprint":{"used_tokens":12},"envelopes":[{"schema_version":1,"event_id":"worker-event-1","seq":724,"session_id":"session-1","run_id":"run-1","worker_generation":97,"committed_at_ms":1787155782065,"render":{"ui":true,"durable":true,"prompt":"verbatim"},"payload":{"type":"item","event":"completed","item":{"item":"reasoning","summary":"thinking"}}}]}}}"#;
        let WireFrame::Response {
            body: ResponseBody::SessionRead { result },
            ..
        } = decode_body(response, DEFAULT_FRAME_LIMIT).expect("decode session.read")
        else {
            panic!("expected session.read response");
        };
        assert_eq!(result.session_id, "session-1");
        assert_eq!(result.range.start_seq, 1);
        assert_eq!(result.range.end_seq, 500);
        assert_eq!(result.head_seq, 724);
        assert_eq!(result.envelopes[0]["run_id"], "run-1");
        assert_eq!(result.envelopes[0]["worker_generation"], 97);
    }

    #[cfg(unix)]
    #[test]
    fn staged_paste_attachment_read_rejects_a_final_component_symlink() {
        use std::os::unix::fs::symlink;

        let temp_root = std::env::temp_dir();
        let id = uuid::Uuid::new_v4().simple().to_string();
        let target = temp_root.join(format!("diffforge-paste-target-{id}.png"));
        let staged = temp_root.join(format!("diffforge-paste-link-{id}.png"));
        std::fs::write(&target, b"must not follow this").expect("write staged target");
        symlink(&target, &staged).expect("create staged symlink");

        assert!(read_staged_paste_attachment(staged.to_str().expect("UTF-8 path")).is_err());

        std::fs::remove_file(&staged).expect("remove staged symlink");
        std::fs::remove_file(&target).expect("remove staged target");
    }

    #[cfg(unix)]
    #[test]
    fn staged_paste_attachment_read_accepts_every_staged_image_mime() {
        let temp_root = std::env::temp_dir();
        let id = uuid::Uuid::new_v4().simple().to_string();
        for (extension, expected_mime) in [
            ("png", "image/png"),
            ("jpg", "image/jpeg"),
            ("gif", "image/gif"),
            ("webp", "image/webp"),
        ] {
            let staged = temp_root.join(format!("diffforge-paste-{id}.{extension}"));
            std::fs::write(&staged, b"pasted image").expect("write staged image");
            let (bytes, mime) = read_staged_paste_attachment(staged.to_str().expect("UTF-8 path"))
                .expect("read staged image");
            assert_eq!(bytes, b"pasted image");
            assert_eq!(mime, expected_mime);
            std::fs::remove_file(staged).expect("remove staged image");
        }
    }

    #[cfg(unix)]
    #[test]
    fn attachment_upload_failure_degrades_to_text_only() {
        let attachment = SurfaceAttachmentWire {
            mime: "image/png".to_owned(),
            bytes: 2,
            artifact: "blake3:paste-image".to_owned(),
        };
        assert_eq!(
            attachment_upload_or_text_only(Ok(vec![attachment.clone()])),
            vec![attachment]
        );
        assert!(
            attachment_upload_or_text_only(Err("artifact.put unavailable".to_owned())).is_empty()
        );
    }

    #[cfg(unix)]
    #[test]
    fn current_connection_without_attachment_feature_writes_legacy_publish_bytes() {
        let attachment = SurfaceAttachmentWire {
            mime: "image/png".to_owned(),
            bytes: 2,
            artifact: "blake3:paste-image".to_owned(),
        };
        let legacy_connection = ConnectionSnapshot {
            connected: true,
            capabilities_granted: BTreeSet::from([Capability::Control]),
            features: BTreeSet::from([
                FEATURE_INPUT_MIRROR_V1.to_owned(),
                FEATURE_ARTIFACT_PUT_V1.to_owned(),
            ]),
            ..ConnectionSnapshot::default()
        };
        let current_connection = ConnectionSnapshot {
            features: BTreeSet::from([
                FEATURE_INPUT_MIRROR_V1.to_owned(),
                FEATURE_INPUT_MIRROR_ATTACHMENTS_V1.to_owned(),
                FEATURE_ARTIFACT_PUT_V1.to_owned(),
            ]),
            ..legacy_connection.clone()
        };
        assert_eq!(
            attachments_for_current_connection(&current_connection, vec![attachment.clone()]),
            vec![attachment.clone()]
        );

        let gated = WireFrame::Request {
            request_id: "req-publish".to_owned(),
            body: RequestBody::SessionSurfacePublish {
                session_id: "session-1".to_owned(),
                input: Some(SurfaceInputPublishWire {
                    text: "full composer text".to_owned(),
                    attachments: attachments_for_current_connection(
                        &legacy_connection,
                        vec![attachment],
                    ),
                    revision: 8,
                }),
                status: None,
            },
        };
        let legacy = WireFrame::Request {
            request_id: "req-publish".to_owned(),
            body: RequestBody::SessionSurfacePublish {
                session_id: "session-1".to_owned(),
                input: Some(SurfaceInputPublishWire {
                    text: "full composer text".to_owned(),
                    attachments: Vec::new(),
                    revision: 8,
                }),
                status: None,
            },
        };
        assert_eq!(
            encode_framed(&gated, DEFAULT_FRAME_LIMIT).expect("encode gated publish"),
            encode_framed(&legacy, DEFAULT_FRAME_LIMIT).expect("encode legacy publish")
        );
    }

    #[test]
    fn surface_attachment_refs_and_structured_status_follow_feature_gates() {
        let frame = br#"{"v":1,"kind":"session_surface_delta","session_id":"session-1","input":{"text":"inspect this image","attachments":[{"mime":"image/png","bytes":2,"artifact":"blake3:paste-image"}],"revision":9,"owner":"tui-connection"},"status":{"line":"[ RUNNING ] 3k tok","state":"running","detail":"applying patch 3/5","revision":4,"owner":"tui-connection"}}"#;
        let WireFrame::SessionSurfaceDelta {
            input: wire_input,
            status: wire_status,
            ..
        } = decode_body(frame, DEFAULT_FRAME_LIMIT).expect("decode Lane S surface fixture")
        else {
            panic!("expected SessionSurfaceDelta");
        };

        let present = BTreeSet::from([
            FEATURE_INPUT_MIRROR_V1.to_owned(),
            FEATURE_INPUT_MIRROR_ATTACHMENTS_V1.to_owned(),
            FEATURE_STATUS_SEGMENT_V1.to_owned(),
            FEATURE_STATUS_SEGMENT_STRUCTURED_V1.to_owned(),
        ]);
        let (present_input, present_status) =
            gated_surface_snapshot(&present, wire_input.clone(), wire_status.clone());
        let (input, status) = RevisionGate::default()
            .accept(present_input, present_status)
            .expect("present fixture emits a snapshot");
        let input = input.expect("input mirror");
        assert_eq!(input.attachments.len(), 1);
        assert_eq!(input.attachments[0].artifact, "blake3:paste-image");
        assert_eq!(input.attachments[0].name, "blake3:paste-image");
        assert_eq!(input.attachments[0].mime, "image/png");
        assert_eq!(input.attachments[0].size, 2);
        let status = status.expect("status segment");
        assert_eq!(status.line, "[ RUNNING ] 3k tok");
        assert_eq!(status.state.as_deref(), Some("running"));
        assert_eq!(status.detail.as_deref(), Some("applying patch 3/5"));

        let absent = BTreeSet::from([
            FEATURE_INPUT_MIRROR_V1.to_owned(),
            FEATURE_STATUS_SEGMENT_V1.to_owned(),
        ]);
        let (absent_input, absent_status) =
            gated_surface_snapshot(&absent, wire_input, wire_status);
        let (input, status) = RevisionGate::default()
            .accept(absent_input, absent_status)
            .expect("legacy fixture still emits raw surfaces");
        assert!(input.expect("input mirror").attachments.is_empty());
        let status = status.expect("status segment");
        assert_eq!(status.line, "[ RUNNING ] 3k tok");
        assert!(status.state.is_none());
        assert!(status.detail.is_none());
    }

    #[test]
    fn resident_turn_submit_selected_mode_reaches_reference_wire() {
        // Harness source: crates/haider-rpc/src/frame.rs:1966-1978 at 0a68109.
        let submit = WireFrame::Request {
            request_id: "req-resident".to_owned(),
            body: resident_turn_submit_body(
                "diffforge-resident-turn-test".to_owned(),
                "session-1".to_owned(),
                7,
                "continue the work".to_owned(),
                DeliveryMode::Subturn,
            ),
        };
        let framed = encode_framed(&submit, DEFAULT_FRAME_LIMIT).expect("encode resident submit");
        assert_eq!(
            std::str::from_utf8(&framed[4..]).expect("resident submit JSON"),
            r#"{"v":1,"kind":"request","request_id":"req-resident","body":{"method":"turn.submit_from_cli","command_id":"diffforge-resident-turn-test","session_id":"session-1","worker_generation":7,"text":"continue the work","attachments":[],"mode":"subturn"}}"#
        );
        assert_eq!(
            u32::from_be_bytes(framed[..4].try_into().expect("resident submit prefix")) as usize,
            framed.len() - 4
        );
        assert_eq!(
            decode_body(&framed[4..], DEFAULT_FRAME_LIMIT).expect("decode resident submit"),
            submit
        );
    }

    #[cfg(unix)]
    #[test]
    fn resident_turn_submit_features_require_queue_control_only_for_explicit_modes() {
        assert_eq!(
            resident_turn_submit_features(false),
            BTreeSet::from([FEATURE_RESIDENT_TURN_SUBMIT_V1.to_string()]),
            "implicit legacy submissions must not require queue_control_v1",
        );
        assert_eq!(
            resident_turn_submit_features(true),
            BTreeSet::from([
                FEATURE_QUEUE_CONTROL_V1.to_string(),
                FEATURE_RESIDENT_TURN_SUBMIT_V1.to_string(),
            ]),
            "explicit resident submissions require both feature contracts",
        );
    }

    #[test]
    fn queue_control_request_and_success_response_frames_match_reference_json() {
        // RequestBody queue shapes: crates/haider-rpc/src/frame.rs:1995-2014
        // at harness commit 0a68109.
        let request = |request_id: &str, body| WireFrame::Request {
            request_id: request_id.to_string(),
            body,
        };
        let cases = [
            (
                request(
                    "req-list",
                    RequestBody::QueueList {
                        session_id: "session-1".to_string(),
                    },
                ),
                r#"{"v":1,"kind":"request","request_id":"req-list","body":{"method":"queue.list","session_id":"session-1"}}"#,
            ),
            (
                request(
                    "req-remove",
                    RequestBody::QueueRemove {
                        session_id: "session-1".to_string(),
                        id: "user-queued-1".to_string(),
                        revision: 31,
                    },
                ),
                r#"{"v":1,"kind":"request","request_id":"req-remove","body":{"method":"queue.remove","session_id":"session-1","id":"user-queued-1","revision":31}}"#,
            ),
            (
                request(
                    "req-promote",
                    RequestBody::QueuePromoteSteer {
                        session_id: "session-1".to_string(),
                        id: "user-queued-2".to_string(),
                        revision: 33,
                    },
                ),
                r#"{"v":1,"kind":"request","request_id":"req-promote","body":{"method":"queue.promote_steer","session_id":"session-1","id":"user-queued-2","revision":33}}"#,
            ),
        ];
        for (frame, expected) in cases {
            let encoded = encode_framed(&frame, DEFAULT_FRAME_LIMIT).expect("encode queue request");
            assert_eq!(
                std::str::from_utf8(&encoded[4..]).expect("queue request JSON"),
                expected
            );
            assert_eq!(
                decode_body(&encoded[4..], DEFAULT_FRAME_LIMIT).expect("decode queue request"),
                frame
            );
        }

        // ResponseBody queue shapes: crates/haider-rpc/src/frame.rs:2455-2475.
        let list_json = br#"{"v":1,"kind":"response","request_id":"req-list","body":{"method":"queue.list","session_id":"session-1","revision":31,"rows":[{"id":"user-queued-1","text":"  keep this text\nverbatim  ","mode":"queue","ordinal":1,"created_at_ms":1753500000000}]}}"#;
        let list_frame = decode_body(list_json, DEFAULT_FRAME_LIMIT).expect("decode queue.list");
        let WireFrame::Response { body, .. } = list_frame.clone() else {
            panic!("expected queue.list response");
        };
        assert_eq!(
            &encode_framed(&list_frame, DEFAULT_FRAME_LIMIT).expect("re-encode queue.list")[4..],
            list_json
        );
        let snapshot = queue_list_response(body).expect("authoritative list");
        assert_eq!(snapshot.session_id, "session-1");
        assert_eq!(snapshot.revision, 31);
        assert_eq!(snapshot.rows[0].text, "  keep this text\nverbatim  ");

        for (json, expected_id, expected_revision, promote) in [
            (
                br#"{"v":1,"kind":"response","request_id":"req-remove","body":{"method":"queue.remove","session_id":"session-1","id":"user-queued-1","revision":33}}"#
                    .as_slice(),
                "user-queued-1",
                33,
                false,
            ),
            (
                br#"{"v":1,"kind":"response","request_id":"req-promote","body":{"method":"queue.promote_steer","session_id":"session-1","id":"user-queued-2","revision":36}}"#
                    .as_slice(),
                "user-queued-2",
                36,
                true,
            ),
        ] {
            let frame = decode_body(json, DEFAULT_FRAME_LIMIT).expect("decode queue mutation");
            assert_eq!(
                &encode_framed(&frame, DEFAULT_FRAME_LIMIT)
                    .expect("re-encode queue mutation")[4..],
                json
            );
            let WireFrame::Response { body, .. } = frame else {
                panic!("expected queue mutation response");
            };
            let receipt = queue_mutation_response(body, promote).expect("queue mutation receipt");
            assert_eq!(receipt.id, expected_id);
            assert_eq!(receipt.revision, expected_revision);
        }
    }

    #[cfg(unix)]
    #[test]
    fn queue_feature_absence_is_unsupported_never_an_empty_list() {
        let connection = ConnectionSnapshot {
            connected: true,
            capabilities_granted: BTreeSet::from([Capability::View, Capability::Control]),
            ..ConnectionSnapshot::default()
        };
        let response = queue_preflight(&connection).map(|()| ResponseBody::QueueList {
            session_id: "session-1".to_string(),
            revision: 0,
            rows: Vec::new(),
        });
        let error = queue_list_result(response).expect_err("absence is not an empty queue");
        assert_eq!(error.code, "unsupported");
        assert!(error.message.contains(FEATURE_QUEUE_CONTROL_V1));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn view_only_queue_snapshot_is_rejected_without_live_authority() {
        let connection = ConnectionSnapshot {
            connected: true,
            capabilities_granted: BTreeSet::from([Capability::View]),
            features: BTreeSet::from([FEATURE_QUEUE_CONTROL_V1.to_string()]),
            ..ConnectionSnapshot::default()
        };
        queue_preflight(&connection).expect("View may read queue.list");
        let watch = queue_watch_preflight(&connection);
        let result = queue_list_with_watch(async move { watch }, async {
            Ok(ResponseBody::QueueList {
                session_id: "session-1".to_string(),
                revision: 31,
                rows: Vec::new(),
            })
        })
        .await
        .expect_err("an empty list without a live watch is not authoritative");
        assert_eq!(result.code, "capability_denied");
        assert!(result.message.contains("live queue watch"));
        assert!(!result.retryable);
    }

    #[cfg(unix)]
    async fn queue_snapshot_in_response_order(attach_first: bool) -> QueueListResult {
        let (watch_tx, watch_rx) = oneshot::channel();
        let (list_tx, list_rx) = oneshot::channel();
        let task = tokio::spawn(async move {
            queue_list_with_watch(
                async { watch_rx.await.expect("watch response sender") },
                async { list_rx.await.expect("list response sender") },
            )
            .await
        });

        let list = Ok(ResponseBody::QueueList {
            session_id: "session-1".to_string(),
            revision: 31,
            rows: vec![QueueRowWire {
                id: "held-1".to_string(),
                text: "verbatim".to_string(),
                mode: DeliveryMode::Queue,
                ordinal: 1,
                created_at_ms: 1_753_500_000_000,
            }],
        });
        if attach_first {
            watch_tx.send(Ok(())).expect("send watch readiness");
            tokio::task::yield_now().await;
            assert!(
                !task.is_finished(),
                "watch alone must not publish authority"
            );
            list_tx.send(list).expect("send list response");
        } else {
            list_tx.send(list).expect("send list response");
            tokio::task::yield_now().await;
            assert!(!task.is_finished(), "list alone must not publish authority");
            watch_tx.send(Ok(())).expect("send watch readiness");
        }
        task.await
            .expect("queue authority task")
            .expect("watch-backed queue snapshot")
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn attach_first_and_list_first_converge_to_the_same_authoritative_snapshot() {
        let attach_first = queue_snapshot_in_response_order(true).await;
        let list_first = queue_snapshot_in_response_order(false).await;
        assert_eq!(attach_first, list_first);
        assert_eq!(attach_first.revision, 31);
        assert_eq!(attach_first.rows[0].id, "held-1");
    }

    #[cfg(unix)]
    #[test]
    fn queue_list_source_wires_watch_readiness_into_snapshot_authority() {
        let source = include_str!("haider_rpc_ade.rs");
        let queue_list_source = source
            .split_once("pub async fn queue_list(")
            .map(|(_, tail)| tail)
            .and_then(|tail| tail.split_once("#[tauri::command").map(|(body, _)| body))
            .expect("queue_list source body");
        assert!(
            queue_list_source.contains("queue_list_with_watch("),
            "queue.list must use the watch-backed authority coordinator",
        );
        assert!(
            queue_list_source.contains("queue_watch_start(app, provider_session_id.clone())"),
            "queue.list must establish the live watch before returning authority",
        );
    }

    #[test]
    fn failed_queue_list_carries_daemon_reason_never_empty() {
        let error = queue_list_result(Ok(ResponseBody::Error {
            code: "store_unavailable".to_string(),
            message: "queue journal could not be read".to_string(),
            retryable: true,
            data: None,
        }))
        .expect_err("a failed list has no queue snapshot");
        assert_eq!(error.code, "store_unavailable");
        assert_eq!(error.message, "queue journal could not be read");
        assert!(error.retryable);
    }

    #[test]
    fn revision_conflict_remains_typed_through_tauri_error_shape() {
        // Response error carrier: crates/haider-rpc/src/frame.rs:2970-2991;
        // typed conflict: frame.rs:3023-3031,3089-3094 (commit 0a68109).
        let error = queue_mutation_response(
            ResponseBody::Error {
                code: "revision_conflict".to_string(),
                message: "queue revision changed".to_string(),
                retryable: true,
                data: Some(serde_json::json!({
                    "kind": "revision_conflict",
                    "expected_revision": 31,
                    "current_revision": 40,
                })),
            },
            false,
        )
        .expect_err("stale mutation must be rejected");
        assert_eq!(
            serde_json::to_value(error).expect("serialize Tauri rejection"),
            serde_json::json!({
                "code": "revision_conflict",
                "message": "queue revision changed",
                "retryable": true,
                "data": {
                    "kind": "revision_conflict",
                    "expected_revision": 31,
                    "current_revision": 40,
                }
            })
        );
    }

    #[test]
    fn queue_changed_requires_complete_typed_payload_before_forwarding() {
        // Session event carrier: crates/haider-rpc/src/frame.rs:3255-3275;
        // QueueDelta: crates/haider-protocol/src/queue.rs:7-49 (commit 0a68109).
        let event = br#"{"v":1,"kind":"event","attachment_id":"attachment-1","session_id":"session-1","envelope":{"schema_version":1,"event_id":"queue-change-31","seq":31,"session_id":"session-1","device_id":"daemon","authority_epoch":2,"worker_generation":7,"committed_at_ms":1753500000001,"render":{"ui":true,"durable":true,"prompt":"omit"},"payload":{"type":"queue_changed","revision":31,"change":{"kind":"enqueued","row":{"id":"user-queued-1","text":"  keep this text\nverbatim  ","mode":"steer","ordinal":1,"created_at_ms":1753500000000}}}}}"#;
        let WireFrame::Event {
            attachment_id,
            session_id,
            envelope,
        } = decode_body(event, DEFAULT_FRAME_LIMIT).expect("decode session event frame")
        else {
            panic!("expected Event frame");
        };
        assert_eq!(attachment_id, "attachment-1");
        assert_eq!(session_id, "session-1");
        assert_eq!(envelope.session_id, "session-1");
        let decoded = parse_queue_changed_payload(envelope.seq, &envelope.payload)
            .expect("complete delta decodes")
            .expect("QueueChanged is forwardable");
        assert_eq!(
            serde_json::to_value(decoded).expect("encode forwarded delta"),
            serde_json::json!({
                "type": "queue_changed",
                "revision": 31,
                "change": {
                    "kind": "enqueued",
                    "row": {
                        "id": "user-queued-1",
                        "text": "  keep this text\nverbatim  ",
                        "mode": "steer",
                        "ordinal": 1,
                        "created_at_ms": 1_753_500_000_000_u64,
                    }
                }
            })
        );

        for malformed in [
            serde_json::json!({
                "type": "queue_changed",
                "change": {"kind": "removed", "id": "user-queued-1"}
            }),
            serde_json::json!({
                "type": "queue_changed",
                "revision": 30,
                "change": {"kind": "removed", "id": "user-queued-1"}
            }),
            serde_json::json!({
                "type": "queue_changed",
                "revision": 31,
                "change": {"kind": "removed", "id": ""}
            }),
        ] {
            assert!(
                parse_queue_changed_payload(31, &malformed).is_err(),
                "malformed QueueChanged must be dropped: {malformed}"
            );
        }
    }

    #[test]
    fn turn_submit_response_preserves_typed_disposition() {
        // Harness source: crates/haider-rpc/src/frame.rs:2636-2647 and
        // SubmitDisposition at frame.rs:2999-3010 (commit 0a68109).
        let response = br#"{"v":1,"kind":"response","request_id":"req-submit","body":{"method":"turn.submit","session_id":"session-1","run_id":"run-1","accepted_seq":31,"worker_generation":7,"disposition":"steer_pending"}}"#;
        assert!(matches!(
            decode_body(response, DEFAULT_FRAME_LIMIT).expect("decode turn.submit receipt"),
            WireFrame::Response {
                body: ResponseBody::TurnSubmit {
                    session_id,
                    accepted_seq: 31,
                    disposition: SubmitDisposition::SteerPending,
                    ..
                },
                ..
            } if session_id == "session-1"
        ));
    }

    #[test]
    fn command_door_request_frames_match_daemon_reference_json_bytes() {
        let list = WireFrame::Request {
            request_id: "req-command-list".to_owned(),
            body: RequestBody::CommandList {
                query: "".to_owned(),
                in_session: true,
                slots: serde_json::json!({
                    "providers": [["openai", "OpenAI"]],
                    "models": [["openai/gpt-5", "OpenAI · GPT-5"]],
                    "accounts": [["work", "Work"]],
                    "efforts": [["high", "High"]],
                    "custom_commands": [["release-notes", "Release notes"]]
                }),
            },
        };
        let framed = encode_framed(&list, DEFAULT_FRAME_LIMIT).expect("encode command.list");
        assert_eq!(
            std::str::from_utf8(&framed[4..]).expect("command.list JSON"),
            r#"{"v":1,"kind":"request","request_id":"req-command-list","body":{"method":"command.list","query":"","in_session":true,"slots":{"accounts":[["work","Work"]],"custom_commands":[["release-notes","Release notes"]],"efforts":[["high","High"]],"models":[["openai/gpt-5","OpenAI · GPT-5"]],"providers":[["openai","OpenAI"]]}}}"#
        );
        assert_eq!(
            decode_body(&framed[4..], DEFAULT_FRAME_LIMIT).expect("decode command.list"),
            list
        );

        let invoke = WireFrame::Request {
            request_id: "req-command-invoke".to_owned(),
            body: RequestBody::CommandInvoke {
                command_id: "diffforge-command-1".to_owned(),
                command: "/rename new title".to_owned(),
                session_id: Some("session-1".to_owned()),
            },
        };
        let framed = encode_framed(&invoke, DEFAULT_FRAME_LIMIT).expect("encode command.invoke");
        assert_eq!(
            std::str::from_utf8(&framed[4..]).expect("command.invoke JSON"),
            r#"{"v":1,"kind":"request","request_id":"req-command-invoke","body":{"method":"command.invoke","command_id":"diffforge-command-1","command":"/rename new title","session_id":"session-1"}}"#
        );
        assert_eq!(
            decode_body(&framed[4..], DEFAULT_FRAME_LIMIT).expect("decode command.invoke"),
            invoke
        );

        let launcher = WireFrame::Request {
            request_id: "req-launcher-invoke".to_owned(),
            body: RequestBody::CommandInvoke {
                command_id: "diffforge-command-2".to_owned(),
                command: "/new".to_owned(),
                session_id: None,
            },
        };
        let framed = encode_framed(&launcher, DEFAULT_FRAME_LIMIT).expect("encode launcher invoke");
        assert_eq!(
            std::str::from_utf8(&framed[4..]).expect("launcher command.invoke JSON"),
            r#"{"v":1,"kind":"request","request_id":"req-launcher-invoke","body":{"method":"command.invoke","command_id":"diffforge-command-2","command":"/new"}}"#
        );
    }

    #[test]
    fn command_catalog_preserves_argument_parent_and_unknown_ownership() {
        let response = br#"{"v":1,"kind":"response","request_id":"req-command-list","body":{"method":"command.list","items":[{"kind":"argument","ownership":"future_owner","label":"GPT-5","description":"Choose GPT-5.","name":"model","value":"gpt-5","arg_hint":"<model>","session_only":false},{"kind":"future_kind","ownership":"client_view","label":"Future","description":"Added later.","name":"future","value":null,"arg_hint":null,"session_only":true}]}}"#;
        let WireFrame::Response {
            body: ResponseBody::CommandList { items },
            ..
        } = decode_body(response, DEFAULT_FRAME_LIMIT).expect("decode command.list response")
        else {
            panic!("expected command.list response");
        };
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].kind, CommandKindWire::Argument);
        assert_eq!(items[0].ownership, CommandOwnershipWire::Unknown);
        assert_eq!(items[0].name, "model");
        assert_eq!(items[0].value.as_deref(), Some("gpt-5"));
        assert_eq!(items[1].kind, CommandKindWire::Unknown);
        assert_eq!(items[1].ownership, CommandOwnershipWire::ClientView);
    }

    #[test]
    fn snapshot_availability_decodes_released_944_compat_shapes_without_zero_sentinels() {
        let response = |body: Value| {
            serde_json::from_value::<VersionedFrame>(serde_json::json!({
                "v": 1,
                "kind": "response",
                "request_id": "snapshot-fixture",
                "body": body,
            }))
            .expect("released snapshot fixture must decode")
            .frame
        };

        let WireFrame::Response {
            body: ResponseBody::AccountList { availability, .. },
            ..
        } = response(serde_json::json!({"method":"account.list", "descriptors":[]}))
        else {
            panic!("account.list response expected");
        };
        assert_eq!(availability, None, "legacy omission stays ambiguous");

        let WireFrame::Response {
            body:
                ResponseBody::ProviderList {
                    revision,
                    availability,
                    ..
                },
            ..
        } = response(serde_json::json!({
            "method":"provider.list",
            "providers":[],
            "revision":0,
            "availability":{"state":"unavailable", "reason":"registry_down"}
        }))
        else {
            panic!("provider.list response expected");
        };
        assert_eq!(revision, 0, "zero remains the supplied revision");
        assert_eq!(
            availability,
            Some(SnapshotAvailabilityWire::Unavailable {
                reason: "registry_down".to_string(),
            })
        );

        let WireFrame::Response {
            body:
                ResponseBody::UsageReport {
                    report,
                    availability,
                },
            ..
        } = response(serde_json::json!({
            "method":"usage.report",
            "report":{"generated_at_ms":0, "accounts":[]},
            "availability":{"state":"unknown"}
        }))
        else {
            panic!("usage.report response expected");
        };
        assert_eq!(report["generated_at_ms"], 0);
        assert_eq!(availability, Some(SnapshotAvailabilityWire::Unknown));
    }

    #[cfg(unix)]
    #[test]
    fn usage_history_gate_failure_and_absent_day_are_distinct() {
        // Feature authority: crates/haider-rpc/src/frame.rs:376-378.
        assert_eq!(
            usage_history_day_from_rpc(
                "2026-08-24",
                Some(Err(format!(
                    "missing_feature: daemon does not advertise {FEATURE_USAGE_HISTORY_V1}"
                )))
            ),
            Ok(UsageHistoryDayRead::Unsupported),
            "a missing bit is unsupported, never empty history"
        );

        let failed = usage_history_day_from_rpc(
            "2026-08-24",
            Some(Err("socket closed during ledger read".to_string())),
        )
        .expect_err("an RPC failure must remain an error");
        assert!(
            failed.contains("socket closed during ledger read"),
            "the transport reason must survive: {failed}"
        );

        // Response authority: crates/haider-rpc/src/frame.rs:2942-2950 says
        // device_id is present even when day is absent.
        assert_eq!(
            usage_history_day_from_rpc(
                "2026-08-24",
                Some(Ok(ResponseBody::UsageHistoryDay {
                    date: "2026-08-24".to_string(),
                    device_id: "device-ledger-a".to_string(),
                    day: None,
                    availability: Some(SnapshotAvailabilityWire::Available),
                }))
            ),
            Ok(UsageHistoryDayRead::NoDay {
                date: "2026-08-24".to_string(),
                device_id: "device-ledger-a".to_string(),
                availability: Some(SnapshotAvailabilityWire::Available),
            })
        );
    }

    #[test]
    fn usage_history_wire_keeps_anonymous_lane_and_optional_meter_facts() {
        // Key/meter authority: crates/haider-protocol/src/usage.rs:34-50 and
        // :76-104. The `{ "id": 2 }` key is present in the live 2026-08-24
        // backfill and is not a malformed descriptor.
        let body: ResponseBody = serde_json::from_value(serde_json::json!({
            "method": "usage.history_day",
            "date": "2026-08-24",
            "device_id": "device-live-probe",
            "day": {
                "date": "2026-08-24",
                "device_id": "device-live-probe",
                "backfilled": true,
                "keys": [{"id": 2}],
                "slots": (0..96).map(|index| if index == 7 {
                    serde_json::json!({
                        "rows": [{
                            "key_id": 2,
                            "role": "root",
                            "requests": 0,
                            "errors": 3,
                            "input_tokens": 0,
                            "output_tokens": 0,
                            "cache_read_tokens": 0,
                            "cache_write_tokens": 0,
                            "reasoning_tokens": 0
                        }],
                        "subagents_spawned": 0
                    })
                } else {
                    Value::Null
                }).collect::<Vec<_>>(),
                "meter_samples": [{
                    "account": "haider-code-api",
                    "window": "weekly",
                    "basis_points": 100,
                    "sampled_at_ms": 1_777_000_000_000_u64,
                    "stale": false
                }],
                "version_changes": [{
                    "daemon_version": "0.0.955",
                    "changed_at_ms": 1_777_000_000_000_u64
                }]
            },
            "availability": {"state": "available"}
        }))
        .expect("decode the published anonymous-lane shape");
        let ResponseBody::UsageHistoryDay { day: Some(day), .. } = body else {
            panic!("usage history day expected");
        };
        assert_eq!(day.slots.len(), 96, "usage.rs:122 fixes the slot count");
        assert_eq!(
            day.keys[0],
            UsageHistoryKeyV1 {
                id: 2,
                account: None,
                provider: None,
                model: None,
                api_family: None,
                effort: None,
                speed: None,
            }
        );
        assert_eq!(day.slots[7].as_ref().unwrap().rows[0].errors, 3);
        assert_eq!(day.meter_samples[0].basis_points, 100);
        assert_eq!(day.meter_samples[0].credits, None);
        assert_eq!(day.meter_samples[0].hold, None);
        assert_eq!(day.meter_samples[0].stale, Some(false));
    }

    #[test]
    fn usage_history_requests_encode_the_published_method_and_fields() {
        // Request authority: crates/haider-rpc/src/frame.rs:2361-2367.
        let day = serde_json::to_value(RequestBody::UsageHistoryDay {
            date: "2026-08-24".to_string(),
        })
        .unwrap();
        assert_eq!(
            day,
            serde_json::json!({"method":"usage.history_day", "date":"2026-08-24"})
        );
        let range = serde_json::to_value(RequestBody::UsageHistoryRange {
            through_date: "2026-08-25".to_string(),
            days: 366,
        })
        .unwrap();
        assert_eq!(
            range,
            serde_json::json!({
                "method":"usage.history_range",
                "through_date":"2026-08-25",
                "days":366
            })
        );
    }

    #[test]
    fn command_invoke_decodes_all_outcomes_and_preserves_the_park_fence() {
        let decode_outcome = |fixture: &[u8]| {
            let WireFrame::Response {
                body: ResponseBody::CommandInvoke { outcome },
                ..
            } = decode_body(fixture, DEFAULT_FRAME_LIMIT).expect("decode command.invoke response")
            else {
                panic!("expected command.invoke response");
            };
            outcome
        };

        assert!(matches!(
            decode_outcome(br#"{"v":1,"kind":"response","request_id":"r1","body":{"method":"command.invoke","outcome":{"kind":"receipt","receipt":{"durable":true,"message":"Renamed."}}}}"#),
            CommandInvokeOutcomeWire::Receipt { receipt }
                if receipt["durable"] == true && receipt["message"] == "Renamed."
        ));
        let parked = decode_outcome(br#"{"v":1,"kind":"response","request_id":"r2","body":{"method":"command.invoke","outcome":{"kind":"parked","needs_input":{"kind":"choice","title":"Choose","menu_id":"command-model-1","request_seq":1843,"worker_generation":122,"options":[{"key":"gpt","label":"GPT"}],"future_card_field":[1,2,3]}}}}"#);
        let CommandInvokeOutcomeWire::Parked { needs_input } = parked else {
            panic!("expected Parked outcome");
        };
        assert_eq!(needs_input["menu_id"], "command-model-1");
        assert_eq!(needs_input["request_seq"], 1843);
        assert_eq!(needs_input["worker_generation"], 122);
        assert_eq!(
            needs_input["future_card_field"],
            serde_json::json!([1, 2, 3])
        );

        assert!(matches!(
            decode_outcome(br#"{"v":1,"kind":"response","request_id":"r3","body":{"method":"command.invoke","outcome":{"kind":"client_owned","command":{"kind":"custom","ownership":"client_view","name":"release-notes"}}}}"#),
            CommandInvokeOutcomeWire::ClientOwned { command }
                if command["name"] == "release-notes"
        ));
        assert!(matches!(
            decode_outcome(br#"{"v":1,"kind":"response","request_id":"r4","body":{"method":"command.invoke","outcome":{"kind":"unsupported","command":"/future","reason":"Upgrade the client."}}}"#),
            CommandInvokeOutcomeWire::Unsupported { command, reason }
                if command == "/future" && reason == "Upgrade the client."
        ));
        assert!(matches!(
            decode_outcome(br#"{"v":1,"kind":"response","request_id":"r5","body":{"method":"command.invoke","outcome":{"kind":"future_outcome","added":true}}}"#),
            CommandInvokeOutcomeWire::Unknown
        ));
    }

    #[cfg(unix)]
    #[test]
    fn command_door_preflight_names_a_missing_feature_on_a_live_connection() {
        let connection = ConnectionSnapshot {
            connected: true,
            capabilities_granted: BTreeSet::from([Capability::View, Capability::Control]),
            ..ConnectionSnapshot::default()
        };
        assert_eq!(
            command_preflight(&connection, Capability::View, HAIDER_COMMAND_LIST_FAILED),
            Err(HAIDER_COMMAND_FEATURE_MISSING.to_string())
        );
        assert_eq!(
            command_preflight(
                &ConnectionSnapshot::default(),
                Capability::View,
                HAIDER_COMMAND_LIST_FAILED,
            ),
            Err(HAIDER_COMMAND_NO_CONNECTION.to_string())
        );
    }

    #[test]
    fn account_list_watch_frames_match_reference_json_bytes() {
        // Harness wire authority (haider-run/b2b-tui): feature bit at
        // crates/haider-rpc/src/frame.rs:279-282; request at 2281-2286;
        // response at 2877-2878; AccountsChanged at 3284-3287.
        let request_json = br#"{"v":1,"kind":"request","request_id":"req-account-watch","body":{"method":"account.list_watch"}}"#;
        let request = WireFrame::Request {
            request_id: "req-account-watch".to_string(),
            body: RequestBody::AccountListWatch {},
        };
        assert_eq!(
            &encode_framed(&request, DEFAULT_FRAME_LIMIT)
                .expect("encode account.list_watch request")[4..],
            request_json
        );
        assert_eq!(
            decode_body(request_json, DEFAULT_FRAME_LIMIT)
                .expect("decode account.list_watch request"),
            request
        );

        let response_json = br#"{"v":1,"kind":"response","request_id":"req-account-watch","body":{"method":"account.list_watch","accepted":true}}"#;
        let response = WireFrame::Response {
            request_id: "req-account-watch".to_string(),
            body: ResponseBody::AccountListWatch {
                accepted: Value::Bool(true),
            },
        };
        assert_eq!(
            &encode_framed(&response, DEFAULT_FRAME_LIMIT)
                .expect("encode account.list_watch response")[4..],
            response_json
        );
        assert_eq!(
            decode_body(response_json, DEFAULT_FRAME_LIMIT)
                .expect("decode account.list_watch response"),
            response
        );

        let changed_json = br#"{"v":1,"kind":"accounts_changed","revision":42}"#;
        let changed = WireFrame::AccountsChanged {
            revision: serde_json::json!(42),
        };
        assert_eq!(
            &encode_framed(&changed, DEFAULT_FRAME_LIMIT).expect("encode AccountsChanged")[4..],
            changed_json
        );
        assert_eq!(
            decode_body(changed_json, DEFAULT_FRAME_LIMIT).expect("decode AccountsChanged"),
            changed
        );
    }

    #[cfg(unix)]
    #[test]
    fn account_watch_feature_absence_is_unsupported_not_an_empty_roster() {
        // MUTATION CHECK (executed): bypassing the feature-bit branch fails
        // with `the separate watch bit is required: ()`.
        let mut connection = ConnectionSnapshot {
            connected: true,
            capabilities_granted: BTreeSet::from([Capability::View]),
            features: BTreeSet::from([FEATURE_ACCOUNT_MANAGEMENT_V1.to_string()]),
            ..ConnectionSnapshot::default()
        };
        let watch = account_roster_watch_preflight(&connection)
            .expect_err("the separate watch bit is required");
        let snapshot = account_list_response(
            ResponseBody::AccountList {
                descriptors: vec![serde_json::json!({"alias":"work"})],
                revision: Some(42),
                provider_active: Vec::new(),
                provider_defaults: Vec::new(),
                availability: Some(SnapshotAvailabilityWire::Available),
            },
            watch,
        )
        .expect("account.list remains a present point-in-time snapshot");

        assert_eq!(snapshot.descriptors.len(), 1, "the roster was not erased");
        let AccountRosterWatchState::Unavailable { reason } = snapshot.watch else {
            panic!("an unsupported watch must not be reported live");
        };
        assert_eq!(
            reason,
            "unsupported: the daemon does not advertise account_list_watch_v1"
        );

        connection
            .features
            .insert(FEATURE_ACCOUNT_LIST_WATCH_V1.to_string());
        account_roster_watch_preflight(&connection)
            .expect("View is sufficient for account.list_watch just as it is for account.list");
    }

    #[test]
    fn malformed_accounts_changed_signal_is_dropped_not_forwarded() {
        // MUTATION CHECK (executed): defaulting a missing revision to zero
        // fails with `a missing revision is malformed: ()`.
        let mut forwarded = Vec::new();
        let error = forward_account_roster_change(Value::Null, |payload| forwarded.push(payload))
            .expect_err("a missing revision is malformed");
        assert_eq!(
            error,
            "AccountsChanged revision was not an unsigned integer"
        );
        assert!(
            forwarded.is_empty(),
            "a malformed AccountsChanged signal must not reach the webview"
        );
    }

    #[test]
    fn account_watch_failure_preserves_daemon_reason() {
        // MUTATION CHECK (executed): replacing daemon prose with a generic
        // reason fails with unequal `Unavailable { reason: ... }` values.
        let state = account_watch_state_from_response(ResponseBody::Error {
            code: "store_unavailable".to_string(),
            message: "credential registry publication failed".to_string(),
            retryable: true,
            data: None,
        })
        .expect("a daemon failure is a typed unavailable watch state");
        assert_eq!(
            state,
            AccountRosterWatchState::Unavailable {
                reason: "credential registry publication failed".to_string(),
            }
        );
    }

    #[test]
    fn account_snapshot_keeps_unavailable_watch_state() {
        // MUTATION CHECK (executed): forcing `watch: Live` fails with
        // `left: Live`, `right: Unavailable { reason: "watch transport closed" }`.
        let snapshot = account_list_response(
            ResponseBody::AccountList {
                descriptors: vec![serde_json::json!({"alias":"personal"})],
                revision: Some(7),
                provider_active: Vec::new(),
                provider_defaults: Vec::new(),
                availability: Some(SnapshotAvailabilityWire::Available),
            },
            AccountRosterWatchState::Unavailable {
                reason: "watch transport closed".to_string(),
            },
        )
        .expect("the stale snapshot is still presentable");
        assert_eq!(snapshot.revision, Some(7));
        assert_eq!(snapshot.descriptors.len(), 1);
        assert_eq!(
            snapshot.watch,
            AccountRosterWatchState::Unavailable {
                reason: "watch transport closed".to_string(),
            },
            "snapshot presence and live-watch authority are independent"
        );
    }

    #[test]
    fn account_management_frames_match_reference_json_bytes() {
        let encoded = |frame: WireFrame| {
            let framed = encode_framed(&frame, DEFAULT_FRAME_LIMIT).expect("encode account frame");
            assert_eq!(
                u32::from_be_bytes(framed[..4].try_into().expect("account prefix")) as usize,
                framed.len() - 4
            );
            assert_eq!(
                decode_body(&framed[4..], DEFAULT_FRAME_LIMIT).expect("decode account frame"),
                frame
            );
            std::str::from_utf8(&framed[4..])
                .expect("account JSON")
                .to_string()
        };

        assert_eq!(
            encoded(WireFrame::Request {
                request_id: "req-account-list".to_owned(),
                body: RequestBody::AccountList {
                    provider: Some("openai".to_owned()),
                },
            }),
            r#"{"v":1,"kind":"request","request_id":"req-account-list","body":{"method":"account.list","provider":"openai"}}"#
        );

        assert_eq!(
            encoded(WireFrame::Request {
                request_id: "req-vault-stage".to_owned(),
                body: RequestBody::VaultStage {
                    stage_id: "stage-1".to_owned(),
                    purpose: StagePurpose::ApiKey,
                    secret: SecretWire::new("test-api-key".to_owned()),
                },
            }),
            r#"{"v":1,"kind":"request","request_id":"req-vault-stage","body":{"method":"vault.stage","stage_id":"stage-1","purpose":"api_key","secret":"test-api-key"}}"#
        );

        assert_eq!(
            encoded(WireFrame::Request {
                request_id: "req-import-sources".to_owned(),
                body: RequestBody::AccountOauthImportSources,
            }),
            r#"{"v":1,"kind":"request","request_id":"req-import-sources","body":{"method":"account.oauth_import_sources"}}"#
        );

        assert_eq!(
            encoded(WireFrame::Request {
                request_id: "req-login-api".to_owned(),
                body: RequestBody::AccountLoginApi {
                    command_id: "command-login-api".to_owned(),
                    provider: "openai".to_owned(),
                    alias: Some("work".to_owned()),
                    vault_reference: "vault-reference-1".to_owned(),
                    validation_model: Some("gpt-5".to_owned()),
                },
            }),
            r#"{"v":1,"kind":"request","request_id":"req-login-api","body":{"method":"account.login_api","command_id":"command-login-api","provider":"openai","alias":"work","vault_reference":"vault-reference-1","validation_model":"gpt-5"}}"#
        );

        assert_eq!(
            encoded(WireFrame::Request {
                request_id: "req-oauth-start".to_owned(),
                body: RequestBody::AccountOauthStart {
                    provider: "openai-oauth".to_owned(),
                    desired_alias: "personal".to_owned(),
                    attempt_id: "attempt-1".to_owned(),
                },
            }),
            r#"{"v":1,"kind":"request","request_id":"req-oauth-start","body":{"method":"account.oauth_start","provider":"openai-oauth","desired_alias":"personal","attempt_id":"attempt-1"}}"#
        );

        assert_eq!(
            encoded(WireFrame::Request {
                request_id: "req-oauth-status".to_owned(),
                body: RequestBody::AccountOauthStatus {
                    flow_id: "flow-1".to_owned(),
                    attempt_id: "attempt-1".to_owned(),
                },
            }),
            r#"{"v":1,"kind":"request","request_id":"req-oauth-status","body":{"method":"account.oauth_status","flow_id":"flow-1","attempt_id":"attempt-1"}}"#
        );

        assert_eq!(
            encoded(WireFrame::Request {
                request_id: "req-oauth-add".to_owned(),
                body: RequestBody::AccountAdd {
                    command_id: "command-oauth-add".to_owned(),
                    provider: "openai-oauth".to_owned(),
                    alias: "personal".to_owned(),
                    auth_method: AccountAddMethod::Oauth,
                    flow_id: "flow-1".to_owned(),
                    attempt_id: "attempt-1".to_owned(),
                    oauth_reference: "oauth-reference-1".to_owned(),
                },
            }),
            r#"{"v":1,"kind":"request","request_id":"req-oauth-add","body":{"method":"account.add","command_id":"command-oauth-add","provider":"openai-oauth","alias":"personal","auth_method":"oauth","flow_id":"flow-1","attempt_id":"attempt-1","oauth_reference":"oauth-reference-1"}}"#
        );

        assert_eq!(
            encoded(WireFrame::Request {
                request_id: "req-set-active".to_owned(),
                body: RequestBody::AccountSetActive {
                    command_id: "command-set-active".to_owned(),
                    alias: "personal".to_owned(),
                    confirm_new_epoch: true,
                },
            }),
            r#"{"v":1,"kind":"request","request_id":"req-set-active","body":{"method":"account.set_active","command_id":"command-set-active","alias":"personal","confirm_new_epoch":true}}"#
        );

        assert_eq!(
            encoded(WireFrame::Request {
                request_id: "req-remove".to_owned(),
                body: RequestBody::AccountRemove {
                    command_id: "command-remove".to_owned(),
                    alias: "personal".to_owned(),
                    expected_revision: Some(42),
                },
            }),
            r#"{"v":1,"kind":"request","request_id":"req-remove","body":{"method":"account.remove","command_id":"command-remove","alias":"personal","expected_revision":42}}"#
        );
    }

    #[test]
    fn add_api_key_retries_restage_with_the_same_command_id() {
        let command_id = "command-login-api";
        assert_eq!(
            add_api_key_restage_command_id(command_id, "restage_required", 0),
            Some(command_id)
        );

        // A retry changes only the stage/reference. Its durable command id
        // remains the logical login's original UUID.
        assert_eq!(
            add_api_key_restage_command_id(command_id, "busy", 2),
            Some(command_id)
        );
        assert_eq!(
            add_api_key_restage_command_id(
                command_id,
                "restage_required",
                MAX_ACCOUNT_RESTAGE_RETRIES
            ),
            None
        );
        assert_eq!(
            add_api_key_retry_decision("restage_required", MAX_ACCOUNT_RESTAGE_RETRIES),
            ApiKeyRetryDecision::Terminal
        );
        assert_eq!(
            add_api_key_retry_decision("unauthorized", 0),
            ApiKeyRetryDecision::Terminal
        );
    }

    #[test]
    fn session_seen_frame_matches_reference_json_bytes() {
        let seen = WireFrame::Request {
            request_id: "req-seen".to_owned(),
            body: RequestBody::SessionSeen {
                command_id: "diffforge-session-seen-test".to_owned(),
                session_id: "session-1".to_owned(),
                worker_generation: 7,
            },
        };
        let framed = encode_framed(&seen, DEFAULT_FRAME_LIMIT).expect("encode session seen");
        assert_eq!(
            std::str::from_utf8(&framed[4..]).expect("session seen JSON"),
            r#"{"v":1,"kind":"request","request_id":"req-seen","body":{"method":"session.seen","command_id":"diffforge-session-seen-test","session_id":"session-1","worker_generation":7}}"#
        );
        assert_eq!(
            u32::from_be_bytes(framed[..4].try_into().expect("session seen prefix")) as usize,
            framed.len() - 4
        );
        assert_eq!(
            decode_body(&framed[4..], DEFAULT_FRAME_LIMIT).expect("decode session seen"),
            seen
        );
    }

    #[test]
    fn menu_answer_frame_matches_daemon_reference_json_bytes() {
        let answer = WireFrame::MenuAnswer {
            request_id: Some("request-menu-1".to_owned()),
            command_id: "command-1".to_owned(),
            session_id: "session-1".to_owned(),
            menu_id: "effect-recovery-8145a5758008720489a9af70".to_owned(),
            request_seq: 1843,
            worker_generation: 122,
            option_key: "probe".to_owned(),
            option_index: 0,
            input: None,
        };
        let framed = encode_framed(&answer, DEFAULT_FRAME_LIMIT).expect("encode menu answer");
        assert_eq!(
            std::str::from_utf8(&framed[4..]).expect("menu answer JSON"),
            r#"{"v":1,"kind":"menu_answer","request_id":"request-menu-1","command_id":"command-1","session_id":"session-1","menu_id":"effect-recovery-8145a5758008720489a9af70","request_seq":1843,"worker_generation":122,"option_key":"probe","option_index":0}"#
        );
        assert_eq!(
            u32::from_be_bytes(framed[..4].try_into().expect("menu answer prefix")) as usize,
            framed.len() - 4
        );
        assert_eq!(
            decode_body(&framed[4..], DEFAULT_FRAME_LIMIT).expect("decode menu answer"),
            answer
        );
    }

    #[cfg(unix)]
    #[test]
    fn menu_answer_command_id_is_stable_for_one_logical_answer() {
        let command_id =
            session_answer_menu_command_id("session-1", "effect-recovery-1", 1843, 122, "probe");
        assert_eq!(
            command_id,
            "diffforge-menu-answer-381f44d1fdce9b5283082c7364b5dbe20713b8213eb9fd0420497be2751c6269"
        );
        assert_eq!(
            session_answer_menu_command_id("session-1", "effect-recovery-1", 1843, 122, "probe"),
            command_id
        );
        assert!(command_id.starts_with("diffforge-menu-answer-"));

        for different_answer in [
            session_answer_menu_command_id("session-1", "effect-recovery-1", 1843, 122, "retry"),
            session_answer_menu_command_id("session-1", "effect-recovery-2", 1843, 122, "probe"),
            session_answer_menu_command_id("session-1", "effect-recovery-1", 1844, 122, "probe"),
            session_answer_menu_command_id("session-1", "effect-recovery-1", 1843, 123, "probe"),
            session_answer_menu_command_id("session-2", "effect-recovery-1", 1843, 122, "probe"),
        ] {
            assert_ne!(different_answer, command_id);
        }
    }

    #[cfg(unix)]
    #[test]
    fn menu_answer_missing_receipt_reports_safe_retry_uncertainty() {
        assert_eq!(
            session_answer_menu_receipt(None).unwrap_err(),
            HAIDER_NEEDS_INPUT_ANSWER_UNCERTAIN
        );
    }

    #[cfg(unix)]
    #[test]
    fn uncertain_menu_answer_retry_reuses_the_validated_index_after_card_clear() {
        let provider_session_id = "session-uncertain-replay";
        let menu_id = "effect-recovery-uncertain-replay";
        let command_id =
            session_answer_menu_command_id(provider_session_id, menu_id, 1843, 122, "retry");
        session_answer_menu_forget_replay(&command_id);
        assert_eq!(
            session_answer_menu_attempt_option_index(
                &command_id,
                provider_session_id,
                &Value::Null,
                menu_id,
                1843,
                122,
                "retry",
            )
            .unwrap_err(),
            HAIDER_NEEDS_INPUT_STALE
        );

        session_answer_menu_remember_replay(command_id.clone(), provider_session_id.to_string(), 2);
        assert_eq!(
            session_answer_menu_attempt_option_index(
                &command_id,
                provider_session_id,
                &Value::Null,
                menu_id,
                1843,
                122,
                "retry",
            )
            .unwrap(),
            2
        );
        session_answer_menu_forget_replay(&command_id);
    }

    #[cfg(unix)]
    #[test]
    fn uncertain_menu_answer_replay_survives_pre_answer_failures() {
        let command_id = "diffforge-menu-answer-pre-answer-failure";
        let provider_session_id = "session-pre-answer-failure";
        session_answer_menu_remember_replay(
            command_id.to_string(),
            provider_session_id.to_string(),
            3,
        );

        let pre_answer_failure = Err(SessionAnswerMenuRpcError::BeforeAnswer(
            "draining".to_string(),
        ));
        session_answer_menu_update_replay(command_id, provider_session_id, 3, &pre_answer_failure);
        assert_eq!(
            session_answer_menu_replay_option_index(command_id, provider_session_id),
            Some(3)
        );

        let pre_lookup_answer_error =
            Err(SessionAnswerMenuRpcError::Answer("draining".to_string()));
        session_answer_menu_update_replay(
            command_id,
            provider_session_id,
            3,
            &pre_lookup_answer_error,
        );
        assert_eq!(
            session_answer_menu_replay_option_index(command_id, provider_session_id),
            Some(3)
        );

        let conclusive_answer_error = Err(SessionAnswerMenuRpcError::Answer(
            "already_resolved".to_string(),
        ));
        session_answer_menu_update_replay(
            command_id,
            provider_session_id,
            3,
            &conclusive_answer_error,
        );
        assert_eq!(
            session_answer_menu_replay_option_index(command_id, provider_session_id),
            None
        );
    }

    #[test]
    fn menu_answer_option_index_requires_the_callers_fence() {
        let card = serde_json::json!({
            "menu_id": "effect-recovery-1",
            "request_seq": 1843,
            "worker_generation": 122,
            "options": [
                {"key":"probe"},
                {"key":"mark_done"},
                {"key":"retry"},
                {"key":"abandon"}
            ]
        });
        assert_eq!(
            session_answer_menu_option_index(&card, "effect-recovery-1", 1843, 122, "retry")
                .unwrap(),
            2
        );

        for stale_card in [
            serde_json::json!({
                "menu_id": "effect-recovery-2",
                "request_seq": 1843,
                "worker_generation": 122,
                "options": [{"key":"retry"}]
            }),
            serde_json::json!({
                "menu_id": "effect-recovery-1",
                "request_seq": 1844,
                "worker_generation": 122,
                "options": [{"key":"retry"}]
            }),
            serde_json::json!({
                "menu_id": "effect-recovery-1",
                "request_seq": 1843,
                "worker_generation": 123,
                "options": [{"key":"retry"}]
            }),
            serde_json::json!({
                "menu_id": "effect-recovery-1",
                "request_seq": 1843,
                "options": [{"key":"retry"}]
            }),
            Value::Null,
        ] {
            assert_eq!(
                session_answer_menu_option_index(
                    &stale_card,
                    "effect-recovery-1",
                    1843,
                    122,
                    "retry"
                )
                .unwrap_err(),
                HAIDER_NEEDS_INPUT_STALE
            );
        }
        assert_eq!(
            session_answer_menu_option_index(&card, "effect-recovery-1", 1843, 122, "missing")
                .unwrap_err(),
            HAIDER_NEEDS_INPUT_STALE
        );
    }

    #[test]
    fn menu_answer_missing_worker_generation_takes_the_stale_path() {
        let missing_worker_generation = serde_json::json!({
            "menu_id": "effect-recovery-1",
            "request_seq": 1843,
            "options": [{"key":"retry"}]
        });
        let context = session_answer_menu_option_index(
            &missing_worker_generation,
            "effect-recovery-1",
            1843,
            122,
            "retry",
        )
        .map(|_| ());
        let reconnect_called = std::cell::Cell::new(false);
        let error = session_answer_menu_prepare(
            context,
            SessionNeedsInputReachability::NoConnection,
            || reconnect_called.set(true),
        )
        .unwrap_err();
        assert_eq!(error, HAIDER_NEEDS_INPUT_STALE);
        assert_ne!(error, HAIDER_NEEDS_INPUT_NO_CONNECTION);
        assert_ne!(error, HAIDER_NEEDS_INPUT_FEATURE_MISSING);
        assert!(!error.starts_with(HAIDER_NEEDS_INPUT_RPC_FAILED));
        assert!(!reconnect_called.get());
    }

    #[test]
    fn roster_watch_and_session_config_frames_match_reference_json_bytes() {
        let encoded = |frame: WireFrame| {
            let framed = encode_framed(&frame, DEFAULT_FRAME_LIMIT).expect("encode frame");
            std::str::from_utf8(&framed[4..])
                .expect("frame JSON")
                .to_string()
        };
        assert_eq!(
            encoded(WireFrame::Request {
                request_id: "req-roster".to_string(),
                body: RequestBody::SessionListWatch {},
            }),
            r#"{"v":1,"kind":"request","request_id":"req-roster","body":{"method":"session.list_watch"}}"#
        );
        assert_eq!(
            encoded(WireFrame::Request {
                request_id: "req-list".to_string(),
                body: RequestBody::SessionList {
                    cursor: None,
                    limit: 256,
                },
            }),
            r#"{"v":1,"kind":"request","request_id":"req-list","body":{"method":"session.list","limit":256}}"#
        );
        assert_eq!(
            encoded(WireFrame::Request {
                request_id: "req-provider".to_string(),
                body: RequestBody::ProviderList { provider: None },
            }),
            r#"{"v":1,"kind":"request","request_id":"req-provider","body":{"method":"provider.list"}}"#
        );
        assert_eq!(
            encoded(WireFrame::Request {
                request_id: "req-observe".to_string(),
                body: RequestBody::SessionObserve {
                    session_id: "session-1".to_string(),
                    last_event_limit: 0,
                    metadata_only: false,
                },
            }),
            r#"{"v":1,"kind":"request","request_id":"req-observe","body":{"method":"session.observe","session_id":"session-1","last_event_limit":0}}"#
        );
        assert_eq!(
            encoded(WireFrame::Request {
                request_id: "req-attach".to_string(),
                body: RequestBody::SessionAttach {
                    session_id: "session-1".to_string(),
                    after_seq: 42,
                    mode: AttachMode::Control,
                    sealed_replay: false,
                },
            }),
            r#"{"v":1,"kind":"request","request_id":"req-attach","body":{"method":"session.attach","session_id":"session-1","after_seq":42,"mode":"control"}}"#
        );
        assert_eq!(
            encoded(WireFrame::Request {
                request_id: "req-model".to_string(),
                body: RequestBody::SessionSelectModel {
                    command_id: "command-model".to_string(),
                    session_id: "session-1".to_string(),
                    worker_generation: 7,
                    model: "gpt-5".to_string(),
                    provider: Some("openai".to_string()),
                    confirm_new_epoch: false,
                },
            }),
            r#"{"v":1,"kind":"request","request_id":"req-model","body":{"method":"session.select_model","command_id":"command-model","session_id":"session-1","worker_generation":7,"model":"gpt-5","provider":"openai"}}"#
        );
        assert_eq!(
            encoded(WireFrame::Request {
                request_id: "req-effort".to_string(),
                body: RequestBody::SessionSelectEffort {
                    command_id: "command-effort".to_string(),
                    session_id: "session-1".to_string(),
                    worker_generation: 8,
                    effort: Some("xhigh".to_string()),
                    confirm_new_epoch: false,
                },
            }),
            r#"{"v":1,"kind":"request","request_id":"req-effort","body":{"method":"session.select_effort","command_id":"command-effort","session_id":"session-1","worker_generation":8,"effort":"xhigh"}}"#
        );
        assert_eq!(
            encoded(WireFrame::Request {
                request_id: "req-fast".to_string(),
                body: RequestBody::SessionSelectFast {
                    command_id: "command-fast".to_string(),
                    session_id: "session-1".to_string(),
                    worker_generation: 9,
                    enabled: true,
                    confirm_new_epoch: false,
                },
            }),
            r#"{"v":1,"kind":"request","request_id":"req-fast","body":{"method":"session.select_fast","command_id":"command-fast","session_id":"session-1","worker_generation":9,"enabled":true}}"#
        );
        assert_eq!(
            encoded(WireFrame::Request {
                request_id: "req-detach".to_string(),
                body: RequestBody::SessionDetach {
                    attachment_id: "attachment-1".to_string(),
                },
            }),
            r#"{"v":1,"kind":"request","request_id":"req-detach","body":{"method":"session.detach","attachment_id":"attachment-1"}}"#
        );

        let push = br#"{"v":1,"kind":"session_roster_delta","summaries":[{"session_id":"session-1","head_seq":9,"worker_generation":7}]}"#;
        assert!(matches!(
            decode_body(push, DEFAULT_FRAME_LIMIT).unwrap(),
            WireFrame::SessionRosterDelta { summaries } if summaries.len() == 1
        ));
    }

    #[test]
    fn stale_surface_revisions_are_dropped_independently() {
        let mut gate = RevisionGate::default();
        let fresh = gate.accept(
            Some(SurfaceInputWire {
                text: "first".to_owned(),
                attachments: Vec::new(),
                revision: 4,
                owner: "tui".to_owned(),
            }),
            Some(SurfaceStatusWire {
                line: "working".to_owned(),
                state: None,
                detail: None,
                revision: 9,
                owner: "tui".to_owned(),
            }),
        );
        assert!(fresh.is_some());

        assert!(gate
            .accept(
                Some(SurfaceInputWire {
                    text: "equal".to_owned(),
                    attachments: Vec::new(),
                    revision: 4,
                    owner: "tui".to_owned(),
                }),
                Some(SurfaceStatusWire {
                    line: "older".to_owned(),
                    state: None,
                    detail: None,
                    revision: 8,
                    owner: "tui".to_owned(),
                }),
            )
            .is_none());

        let (input, status) = gate
            .accept(
                Some(SurfaceInputWire {
                    text: "new".to_owned(),
                    attachments: Vec::new(),
                    revision: 5,
                    owner: "tui".to_owned(),
                }),
                Some(SurfaceStatusWire {
                    line: "still stale".to_owned(),
                    state: None,
                    detail: None,
                    revision: 9,
                    owner: "tui".to_owned(),
                }),
            )
            .expect("new input survives stale status");
        assert_eq!(input.expect("fresh input").revision, 5);
        assert_eq!(status.expect("cached status").revision, 9);

        let (input, status) = gate
            .accept(
                Some(SurfaceInputWire {
                    text: "new owner".to_owned(),
                    attachments: Vec::new(),
                    revision: 1,
                    owner: "ade".to_owned(),
                }),
                Some(SurfaceStatusWire {
                    line: "still stale".to_owned(),
                    state: None,
                    detail: None,
                    revision: 9,
                    owner: "tui".to_owned(),
                }),
            )
            .expect("a new owner starts a fresh revision domain");
        assert_eq!(input.expect("new owner input").revision, 1);
        assert_eq!(status.expect("cached status").revision, 9);

        let (input, status) = gate
            .accept(
                None,
                Some(SurfaceStatusWire {
                    line: "done".to_owned(),
                    state: None,
                    detail: None,
                    revision: 10,
                    owner: "tui".to_owned(),
                }),
            )
            .expect("clear plus fresh companion is a complete snapshot");
        assert!(input.is_none());
        assert_eq!(status.expect("fresh status").revision, 10);
    }

    #[cfg(unix)]
    #[test]
    fn disconnected_rpc_request_selects_cli_fallback() {
        let (reply, mut answer) = oneshot::channel();
        let mut subscriptions = HashMap::new();
        let mut revisions = HashMap::new();
        let mut roster_app = None;
        let mut account_roster_window = None;
        let (account_roster_watch_tx, _) = watch::channel(AccountRosterWatchState::default());
        apply_disconnected_command(
            ActorCommand::RpcRequest {
                body: RequestBody::SessionList {
                    cursor: None,
                    limit: 256,
                },
                capability: Capability::View,
                features: FeatureGate::all(config_features(&[])),
                error_style: RpcErrorStyle::Detailed,
                reply,
            },
            &mut subscriptions,
            &mut revisions,
            &mut roster_app,
            &mut account_roster_window,
            &account_roster_watch_tx,
        );
        assert!(answer.try_recv().expect("fallback reply").is_none());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn reconnect_nudge_interrupts_the_actor_backoff() {
        let (commands, mut receiver) = mpsc::unbounded_channel();
        let mut subscriptions = HashMap::new();
        let mut revisions = HashMap::new();
        let mut roster_app = None;
        let mut account_roster_window = None;
        let (account_roster_watch_tx, _) = watch::channel(AccountRosterWatchState::default());
        commands
            .send(ActorCommand::ReconnectNow)
            .expect("queue reconnect nudge");

        let continued = tokio::time::timeout(
            Duration::from_millis(100),
            wait_disconnected(
                &mut receiver,
                &mut subscriptions,
                &mut revisions,
                &mut roster_app,
                &mut account_roster_window,
                &account_roster_watch_tx,
                Duration::from_secs(5),
            ),
        )
        .await
        .expect("reconnect nudge must not wait for the five-second backoff");
        assert!(continued);
    }

    #[cfg(unix)]
    #[test]
    fn session_seen_requires_a_live_feature_advertisement() {
        let mut connection = ConnectionSnapshot {
            connected: true,
            features: BTreeSet::from([FEATURE_SESSION_SEEN_V1.to_string()]),
            ..ConnectionSnapshot::default()
        };
        assert!(session_seen_available(&connection));

        connection.features.clear();
        assert!(!session_seen_available(&connection));

        connection
            .features
            .insert(FEATURE_SESSION_SEEN_V1.to_string());
        connection.connected = false;
        assert!(!session_seen_available(&connection));
    }

    #[cfg(unix)]
    #[test]
    fn menu_answer_reports_missing_feature_only_on_a_live_connection() {
        let mut connection = ConnectionSnapshot {
            connected: true,
            ..ConnectionSnapshot::default()
        };
        assert!(!session_needs_input_available(&connection));
        assert_eq!(
            session_needs_input_reachability(&connection),
            SessionNeedsInputReachability::FeatureMissing
        );
        assert_eq!(
            session_answer_menu_pre_answer_error(
                SessionNeedsInputReachability::FeatureMissing,
                Some(&format!(
                    "missing_feature: daemon does not advertise {FEATURE_SESSION_NEEDS_INPUT_V1}"
                )),
            ),
            HAIDER_NEEDS_INPUT_FEATURE_MISSING
        );
        let reconnect_called = std::cell::Cell::new(false);
        assert_eq!(
            session_answer_menu_prepare(
                Ok(()),
                SessionNeedsInputReachability::FeatureMissing,
                || reconnect_called.set(true),
            )
            .unwrap_err(),
            HAIDER_NEEDS_INPUT_FEATURE_MISSING
        );
        assert!(!reconnect_called.get());
        connection
            .features
            .insert(FEATURE_SESSION_NEEDS_INPUT_V1.to_string());
        assert_eq!(
            session_needs_input_reachability(&connection),
            SessionNeedsInputReachability::Ready
        );
    }

    #[cfg(unix)]
    #[test]
    fn menu_answer_reports_no_connection_even_if_old_features_are_retained() {
        let connection = ConnectionSnapshot {
            connected: false,
            features: BTreeSet::from([FEATURE_SESSION_NEEDS_INPUT_V1.to_string()]),
            ..ConnectionSnapshot::default()
        };
        assert!(!session_needs_input_available(&connection));
        assert_eq!(
            session_needs_input_reachability(&connection),
            SessionNeedsInputReachability::NoConnection
        );
        assert_eq!(
            session_answer_menu_pre_answer_error(SessionNeedsInputReachability::NoConnection, None),
            HAIDER_NEEDS_INPUT_NO_CONNECTION
        );
        let reconnect_called = std::cell::Cell::new(false);
        assert_eq!(
            session_answer_menu_prepare(
                Ok(()),
                SessionNeedsInputReachability::NoConnection,
                || reconnect_called.set(true),
            )
            .unwrap_err(),
            HAIDER_NEEDS_INPUT_NO_CONNECTION
        );
        assert!(reconnect_called.get());
    }

    #[cfg(unix)]
    #[test]
    fn menu_answer_connected_pre_answer_failure_is_an_rpc_route_failure() {
        let error = session_answer_menu_result(
            SessionNeedsInputReachability::Ready,
            Err(SessionAnswerMenuRpcError::BeforeAnswer(
                "session.attach timed out".to_string(),
            )),
        )
        .unwrap_err();
        assert!(error.starts_with(HAIDER_NEEDS_INPUT_RPC_FAILED));
        assert!(error.contains("session.attach timed out"));
        assert_ne!(error, HAIDER_NEEDS_INPUT_NO_CONNECTION);
        assert_ne!(error, HAIDER_NEEDS_INPUT_FEATURE_MISSING);
    }

    #[cfg(unix)]
    #[test]
    fn menu_answer_feature_loss_before_final_write_uses_the_feature_case() {
        let error = session_answer_menu_result(
            SessionNeedsInputReachability::Ready,
            Err(SessionAnswerMenuRpcError::Answer(format!(
                "missing_feature: daemon does not advertise {FEATURE_SESSION_NEEDS_INPUT_V1}"
            ))),
        )
        .unwrap_err();
        assert_eq!(error, HAIDER_NEEDS_INPUT_FEATURE_MISSING);
    }

    #[test]
    fn resident_session_binding_frame_preserves_bound_and_unbound_states() {
        let bound = decode_body(
            br#"{"v":1,"kind":"resident_session_binding","session_id":"session-1","worker_generation":129}"#,
            DEFAULT_FRAME_LIMIT,
        )
        .expect("decode bound resident binding");
        assert!(matches!(
            bound,
            WireFrame::ResidentSessionBinding {
                session_id: Some(ref session_id),
                worker_generation: 129,
            } if session_id == "session-1"
        ));

        let unbound = decode_body(
            br#"{"v":1,"kind":"resident_session_binding","worker_generation":129}"#,
            DEFAULT_FRAME_LIMIT,
        )
        .expect("decode unbound resident binding");
        assert!(matches!(
            unbound,
            WireFrame::ResidentSessionBinding {
                session_id: None,
                worker_generation: 129,
            }
        ));
    }

    #[test]
    fn resident_session_binding_frames_require_the_advertised_feature() {
        assert!(resident_binding_snapshot_for_frame(
            &BTreeSet::new(),
            Some("session-legacy".to_string()),
            128,
        )
        .is_none());

        let features = BTreeSet::from([FEATURE_RESIDENT_SESSION_BINDING_V1.to_string()]);
        let bound = resident_binding_snapshot_for_frame(
            &features,
            Some("session-protocol".to_string()),
            129,
        )
        .expect("feature-gated bound frame");
        assert_eq!(bound.supported, Some(true));
        assert!(bound.known);
        assert_eq!(bound.session_id.as_deref(), Some("session-protocol"));
        assert_eq!(bound.worker_generation, Some(129));

        let unbound = resident_binding_snapshot_for_frame(&features, None, 129)
            .expect("feature-gated unbound frame");
        assert!(unbound.known);
        assert_eq!(unbound.session_id, None);
        assert_ne!(unbound, ResidentSessionBindingSnapshot::default());
    }

    #[cfg(unix)]
    fn handshake_test_welcome() -> Welcome {
        Welcome {
            protocol: WIRE_PROTOCOL_VERSION,
            instance_id: "daemon-handshake-test".to_owned(),
            daemon_generation: 7,
            frame_limit: 1_048_576,
            profile_id: "profile-handshake-test".to_owned(),
            daemon_version: "test".to_owned(),
            lifecycle_phase: "ready".to_owned(),
            capabilities_granted: BTreeSet::from([Capability::View, Capability::Control]),
            features: BTreeSet::from([FEATURE_SESSION_NEEDS_INPUT_V1.to_owned()]),
            encoding: None,
        }
    }

    #[cfg(unix)]
    async fn write_raw_json_frame(stream: &mut UnixStream, body: &[u8]) {
        stream
            .write_all(&(body.len() as u32).to_be_bytes())
            .await
            .expect("write raw frame prefix");
        stream.write_all(body).await.expect("write raw frame body");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn handshake_rejects_a_push_before_welcome() {
        let (client, mut server_stream) = UnixStream::pair().expect("test socket pair");
        let welcome = handshake_test_welcome();
        let server = tokio::spawn(async move {
            assert!(matches!(
                read_frame(&mut server_stream, DEFAULT_FRAME_LIMIT)
                    .await
                    .expect("read Hello"),
                WireFrame::Hello(_)
            ));
            write_raw_json_frame(
                &mut server_stream,
                br#"{"v":1,"kind":"resident_session_binding","session_id":"session-1","worker_generation":7}"#,
            )
            .await;
            let _ = write_frame(
                &mut server_stream,
                &WireFrame::Welcome(welcome),
                DEFAULT_FRAME_LIMIT,
                WireEncoding::Json,
            )
            .await;
        });

        let error = handshake_connected_stream(client)
            .await
            .expect_err("the first daemon frame must be Welcome");
        assert!(error.to_string().contains("expected Welcome"));
        server.await.expect("test server");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn handshake_rejects_profile_mismatch() {
        let (client, mut server_stream) = UnixStream::pair().expect("test socket pair");
        let welcome = handshake_test_welcome();
        let server = tokio::spawn(async move {
            assert!(matches!(
                read_frame(&mut server_stream, DEFAULT_FRAME_LIMIT)
                    .await
                    .expect("read Hello"),
                WireFrame::Hello(_)
            ));
            write_frame(
                &mut server_stream,
                &WireFrame::Welcome(welcome),
                DEFAULT_FRAME_LIMIT,
                WireEncoding::Json,
            )
            .await
            .expect("write Welcome");
        });

        let error = handshake_connected_stream_for_profile(client, Some("another-profile"))
            .await
            .expect_err("a nonempty mismatched profile id must fail");
        assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
        assert!(error.to_string().contains("profile_id mismatch"));
        server.await.expect("test server");
    }

    #[test]
    fn socket_path_resolution_matches_profile_hash_without_directory_scanning() {
        assert_eq!(
            hex(&blake3_hash(b"")),
            "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262"
        );
        assert_eq!(
            hex(&blake3_hash(b"abc")),
            "6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85"
        );

        let root = std::env::temp_dir().join(format!("rpc-ade-path-{}", uuid::Uuid::new_v4()));
        let profile = root.join("profile");
        let runtime = root.join("runtime");
        std::fs::create_dir_all(&profile).expect("profile directory");
        std::fs::create_dir_all(&runtime).expect("runtime directory");

        let endpoint =
            deterministic_endpoint(Some(&profile), None, &runtime).expect("deterministic endpoint");
        let name = endpoint
            .file_name()
            .and_then(|name| name.to_str())
            .expect("endpoint basename");
        assert!(name.starts_with("haider-") && name.ends_with(".sock"));
        assert_eq!(name.len(), "haider-".len() + 32 + ".sock".len());

        std::fs::remove_dir_all(root).expect("remove test directory");
    }

    #[cfg(unix)]
    #[test]
    fn config_model_details_require_provider_models_owner_bit() {
        assert_eq!(
            config_provider_feature_gate(),
            [FEATURE_PROVIDER_MANAGEMENT_V1, FEATURE_PROVIDER_MODELS_V1]
        );
    }

    #[cfg(unix)]
    #[test]
    fn session_config_absent_fast_stays_unknown_legacy() {
        let providers = vec![serde_json::json!({
            "provider": "openai",
            "model_details": [{"name": "gpt-5.6-sol", "context_window": 200_000}]
        })];
        let digest = serde_json::json!({
            "session_id": "legacy-session",
            "metadata": {
                "provider": "openai",
                "model": "gpt-5.6-sol"
            }
        });
        let legacy = config_document(&serde_json::json!({}), &providers, digest).unwrap();
        assert_eq!(
            legacy["fast"],
            Value::Null,
            "legacy absence must not become authoritative fast=false"
        );
        assert_eq!(
            legacy["speed"],
            Value::Null,
            "legacy absence must not become authoritative speed=normal"
        );

        for (fast, speed) in [(false, "normal"), (true, "fast")] {
            let digest = serde_json::json!({
                "session_id": "typed-session",
                "metadata": {
                    "provider": "openai",
                    "model": "gpt-5.6-sol",
                    "fast": fast
                }
            });
            let typed = config_document(&serde_json::json!({}), &providers, digest).unwrap();
            assert_eq!(typed["fast"], serde_json::json!(fast));
            assert_eq!(typed["speed"], serde_json::json!(speed));
        }
    }

    #[cfg(unix)]
    #[test]
    fn session_config_carries_observed_subagents_verbatim_and_preserves_absence() {
        let providers = vec![serde_json::json!({
            "provider": "openai",
            "model_details": [{"name": "gpt-5.6-sol", "context_window": 200_000}]
        })];
        let observed_subagents = serde_json::json!([
            {
                "agent_id": "agent-child-a",
                "callsign": "Halley",
                "task": "audit the projection",
                "state": "thinking"
            },
            {
                "agent_id": "agent-child-b",
                "task": "verify the mutation",
                "state": "permission_required"
            }
        ]);
        let digest = serde_json::json!({
            "session_id": "typed-session",
            "metadata": {
                "provider": "openai",
                "model": "gpt-5.6-sol"
            },
            "subagents": observed_subagents.clone()
        });

        let config = config_document(&serde_json::json!({}), &providers, digest).unwrap();
        assert_eq!(
            config["subagents"], observed_subagents,
            "session_config_get must carry every observe subagent entry and field verbatim"
        );
        assert!(
            config.get("subagent_count").is_none(),
            "a count is not a substitute for the observed subagent array"
        );

        let absent = config_document(
            &serde_json::json!({}),
            &providers,
            serde_json::json!({
                "session_id": "legacy-session",
                "metadata": {
                    "provider": "openai",
                    "model": "gpt-5.6-sol"
                }
            }),
        )
        .unwrap();
        assert_eq!(
            absent["subagents"],
            Value::Null,
            "an unobserved subagent field is unknown, not an observed empty array or zero"
        );
    }

    #[test]
    fn a_published_catalog_replaces_the_shipped_import_list() {
        // The shipped list is a floor for daemons predating the catalog, and
        // it is exactly how grok-cli stayed unimportable for a release.
        let published = vec![
            serde_json::json!({"source": "codex", "available": true}),
            serde_json::json!({"source": "grok-cli", "available": false}),
        ];
        assert!(haider_import_source_is_known(Some(&published), "grok-cli"));
        assert!(
            !haider_import_source_is_known(Some(&published), "kimi-code"),
            "a published catalog is the whole answer, not an addition to ours"
        );

        // No catalog published: fall back to what this build shipped knowing.
        assert!(haider_import_source_is_known(None, "kimi-code"));
        assert!(!haider_import_source_is_known(None, "grok-cli"));
    }

    #[tokio::test]
    async fn live_daemon_handshake_advertises_ade_features_when_socket_exists() {
        let Some(path) = resolve_socket_path() else {
            return;
        };
        if !path.exists() {
            return;
        }
        let handshake = tokio::time::timeout(HANDSHAKE_TIMEOUT, connect_and_handshake(&path))
            .await
            .expect("live Haider handshake timed out");
        let (_, welcome) = match handshake {
            Ok(connected) => connected,
            // Sandboxed Cargo runners can see the host socket node while
            // denying connect(2). That environment is equivalent to an
            // unavailable live daemon; every other failure remains fatal.
            Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => return,
            Err(error) => panic!("live Haider handshake failed: {error}"),
        };
        for feature in [
            FEATURE_INPUT_MIRROR_V1,
            FEATURE_SESSION_LIST_WATCH_V1,
            FEATURE_SESSION_CONFIG_V1,
            FEATURE_SESSION_OBSERVE_V1,
            FEATURE_SESSION_MODEL_SELECT_V1,
            FEATURE_SESSION_EFFORT_SELECT_V1,
            FEATURE_SESSION_FAST_SELECT_V1,
            FEATURE_COMMAND_DOOR_V1,
            FEATURE_USAGE_REPORT_V1,
            FEATURE_USAGE_HISTORY_V1,
            FEATURE_HAIDER_CODE_PLAN_STATUS_V1,
            FEATURE_LOOM_V1,
            FEATURE_LOOM_CLI_PRESENCE_V1,
            FEATURE_TYPED_AGENT_INSTALL_V1,
            FEATURE_TYPED_AGENT_INSTALL_CONTROL_V1,
            FEATURE_SESSION_AGENT_TYPE_SELECT_V1,
        ] {
            assert!(
                welcome.features.contains(feature),
                "daemon {} did not advertise {feature}",
                welcome.daemon_version
            );
        }
    }
}

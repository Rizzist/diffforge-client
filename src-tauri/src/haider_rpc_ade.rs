//! Minimal ADE client for Haider's daemon-owned volatile session surfaces.
//!
//! This module deliberately mirrors the stable JSON subset of `haider-rpc`
//! instead of depending on the Haider workspace. Unix-domain frames are a
//! four-byte big-endian body length followed by one negotiated `WireFrame`.

use std::{
    collections::{BTreeSet, HashMap},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        OnceLock,
    },
    time::{Duration, SystemTime},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot, watch};
use zeroize::{Zeroize, Zeroizing};

#[cfg(unix)]
use std::{collections::VecDeque, sync::Mutex as StdMutex};

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
const FEATURE_SESSION_MODEL_SELECT_V1: &str = "session_model_select_v1";
const FEATURE_SESSION_EFFORT_SELECT_V1: &str = "session_effort_select_v1";
const FEATURE_SESSION_FAST_SELECT_V1: &str = "session_fast_select_v1";
const FEATURE_SESSION_ACCOUNT_SELECT_V1: &str = "session_account_select_v1";
const FEATURE_RESIDENT_TURN_SUBMIT_V1: &str = "resident_turn_submit_v1";
const FEATURE_SESSION_SEEN_V1: &str = "session_seen_v1";
const FEATURE_SESSION_NEEDS_INPUT_V1: &str = "session_needs_input_v1";
const FEATURE_ACCOUNT_MANAGEMENT_V1: &str = "account_management_v1";
const FEATURE_ACCOUNT_LOGIN_API_V1: &str = "account_login_api_v1";
const FEATURE_ACCOUNT_OAUTH_PKCE_V1: &str = "account_oauth_pkce_v1";
const FEATURE_ACCOUNT_OAUTH_DEVICE_V1: &str = "account_oauth_device_v1";
const FEATURE_ACCOUNT_OAUTH_IMPORT_V1: &str = "account_oauth_import_v1";
const FEATURE_ACCOUNT_DEVICE_DISCOVERY_V1: &str = "account_device_discovery_v1";
const FEATURE_VAULT_STAGE_V1: &str = "vault_stage_v1";
const HAIDER_ACCOUNTS_UNAVAILABLE: &str = "haider_accounts_unavailable";
const HAIDER_NEEDS_INPUT_UNAVAILABLE: &str = "haider_needs_input_unavailable";
const HAIDER_NEEDS_INPUT_STALE: &str =
    "haider_needs_input_stale: This park moved on; re-read the card.";
const HAIDER_NEEDS_INPUT_ANSWER_UNCERTAIN: &str =
    "haider_needs_input_answer_uncertain: Answer may have landed; retrying is safe.";
#[cfg(unix)]
const SESSION_ANSWER_MENU_REPLAY_LIMIT: usize = 64;
const MAX_ACCOUNT_RESTAGE_RETRIES: usize = 3;
/// `busy` is mailbox backpressure: retrying in the same microsecond spends
/// the whole ladder before the daemon can drain. One short breath per rung.
const ACCOUNT_RETRY_BACKOFF: Duration = Duration::from_millis(120);
const SURFACE_EVENT: &str = "session-surface";
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
}

/// Receipt returned when the daemon durably marks a session as seen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SessionSeen {
    pub session_id: String,
    pub seen_at_ms: u64,
    pub seen_seq: u64,
    pub worker_generation: u64,
}

#[derive(Clone, Serialize)]
pub struct AccountListResult {
    pub descriptors: Vec<Value>,
    pub revision: Option<u64>,
    pub provider_active: Vec<Value>,
    pub provider_defaults: Vec<Value>,
}

impl AccountListResult {
    fn subsystem_absent() -> Self {
        Self {
            descriptors: Vec::new(),
            revision: None,
            provider_active: Vec::new(),
            provider_defaults: Vec::new(),
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "method")]
enum RequestBody {
    #[serde(rename = "artifact.put")]
    ArtifactPut { data_base64: String },
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
    #[serde(rename = "provider.list")]
    ProviderList {},
    #[serde(rename = "session.observe")]
    SessionObserve {
        session_id: String,
        last_event_limit: u32,
    },
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
    #[serde(rename = "session.select_fast")]
    SessionSelectFast {
        command_id: String,
        session_id: String,
        worker_generation: u64,
        enabled: bool,
        #[serde(default, skip_serializing_if = "is_false")]
        confirm_new_epoch: bool,
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
    #[serde(rename = "account.list")]
    AccountList {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        provider: Option<String>,
    },
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
    #[serde(rename = "artifact.put")]
    ArtifactPut { artifact: String, bytes: u64 },
    #[serde(rename = "session.list")]
    SessionList {
        #[serde(default)]
        sessions: Vec<Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        next_cursor: Option<String>,
    },
    #[serde(rename = "session.list_watch")]
    SessionListWatch { accepted: bool },
    #[serde(rename = "provider.list")]
    ProviderList {
        #[serde(default)]
        providers: Vec<Value>,
    },
    #[serde(rename = "session.observe")]
    SessionObserve { digest: Value },
    #[serde(rename = "session.attach")]
    SessionAttach {
        attachment_id: String,
        attach_state: AttachStateWire,
    },
    #[serde(rename = "session.detach")]
    SessionDetach { attachment_id: String },
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
    #[serde(rename = "session.select_fast")]
    SessionSelectFast {
        session_id: String,
        enabled: bool,
        selected_seq: u64,
        worker_generation: u64,
    },
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
    #[serde(rename = "account.device_candidates")]
    AccountDeviceCandidates {
        discovery_disabled: bool,
        #[serde(default)]
        candidates: Vec<Value>,
    },
    #[serde(rename = "account.import_device")]
    AccountImportDevice { descriptor: Value, revision: u64 },
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
    SessionSurfaceDelta {
        session_id: String,
        #[serde(default)]
        input: Option<SurfaceInputWire>,
        #[serde(default)]
        status: Option<SurfaceStatusWire>,
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
enum DeliveryMode {
    Queue,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct AttachStateWire {
    session_id: String,
    requested_after_seq: u64,
    replay_through_seq: u64,
    worker_generation: u64,
    authority_epoch: u64,
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

#[cfg(unix)]
#[derive(Debug, Clone, Default)]
struct ConnectionSnapshot {
    connected: bool,
    roster_watch_active: bool,
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
}

#[cfg(unix)]
type RpcReply = oneshot::Sender<Option<Result<ResponseBody, String>>>;

#[cfg(unix)]
#[derive(Debug, Clone, Copy)]
enum RpcErrorStyle {
    Detailed,
    Public,
    Code,
}

#[cfg(unix)]
type PendingRpcRequest = (RpcReply, RpcErrorStyle);

#[cfg(unix)]
enum ActorCommand {
    RosterAttach {
        app: AppHandle,
    },
    RpcRequest {
        body: RequestBody,
        capability: Capability,
        features: FeatureGate,
        public_errors: bool,
        reply: RpcReply,
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
}

#[cfg(unix)]
static ACTOR: OnceLock<ActorHandle> = OnceLock::new();

#[cfg(unix)]
static ROSTER_WATCH_ACTIVE: AtomicBool = AtomicBool::new(false);

#[cfg(unix)]
fn actor_handle() -> &'static ActorHandle {
    ACTOR.get_or_init(|| {
        let (commands, receiver) = mpsc::unbounded_channel();
        let (connection, _) = watch::channel(ConnectionSnapshot::default());
        tauri::async_runtime::spawn(run_actor(receiver, connection.clone()));
        ActorHandle {
            commands,
            connection,
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

#[cfg(unix)]
async fn rpc_request(
    body: RequestBody,
    capability: Capability,
    features: BTreeSet<String>,
) -> Option<Result<ResponseBody, String>> {
    rpc_request_with_feature_gate(body, capability, FeatureGate::all(features), false).await
}

#[cfg(unix)]
async fn rpc_request_with_feature_gate(
    body: RequestBody,
    capability: Capability,
    features: FeatureGate,
    public_errors: bool,
) -> Option<Result<ResponseBody, String>> {
    let (reply, answer) = oneshot::channel();
    actor_handle()
        .commands
        .send(ActorCommand::RpcRequest {
            body,
            capability,
            features,
            public_errors,
            reply,
        })
        .ok()?;
    tokio::time::timeout(COMMAND_REPLY_TIMEOUT, answer)
        .await
        .ok()?
        .ok()?
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
    match rpc_request_with_feature_gate(body, capability, features, true).await {
        Some(Ok(response)) => Ok(response),
        Some(Err(error)) => Err(account_error(error)),
        None => Err(HAIDER_ACCOUNTS_UNAVAILABLE.to_string()),
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
            true,
        )
        .await
        {
            Some(Ok(ResponseBody::AccountList {
                descriptors,
                revision,
                provider_active,
                provider_defaults,
            })) => Ok(AccountListResult {
                descriptors,
                revision,
                provider_active,
                provider_defaults,
            }),
            Some(Ok(_)) => Err("account.list response method mismatch".to_string()),
            Some(Err(error)) if error.starts_with("missing_feature:") => {
                Ok(AccountListResult::subsystem_absent())
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
                provider_origin,
                loopback_port,
                expires_at_ms,
            } => Ok(AccountOauthStartResult {
                availability,
                flow_id,
                authorization_url,
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

#[tauri::command(rename_all = "snake_case")]
pub async fn account_oauth_import(source: String) -> Result<AccountImportResult, String> {
    if !matches!(source.as_str(), "codex" | "claude-code" | "kimi-code") {
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
pub async fn account_device_candidates() -> Result<AccountDeviceCandidatesResult, String> {
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
pub async fn account_import_device(candidate: String) -> Result<AccountImportResult, String> {
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
fn resident_turn_submit_features() -> BTreeSet<String> {
    BTreeSet::from([FEATURE_RESIDENT_TURN_SUBMIT_V1.to_string()])
}

#[cfg(unix)]
async fn resident_turn_submit_request(body: RequestBody) -> Result<Option<ResponseBody>, String> {
    match rpc_request(body, Capability::Control, resident_turn_submit_features()).await {
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
        true,
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
async fn resident_turn_submit_session_summary(session_id: &str) -> Result<Option<Value>, String> {
    let mut cursor = None;
    loop {
        let Some(response) =
            resident_turn_submit_request(RequestBody::SessionList { cursor, limit: 256 }).await?
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
async fn config_providers(capability: Capability) -> Result<Option<Vec<Value>>, String> {
    let Some(response) = config_request(RequestBody::ProviderList {}, capability, &[]).await?
    else {
        return Ok(None);
    };
    match response {
        ResponseBody::ProviderList { providers } => Ok(Some(providers)),
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
    let fast = metadata
        .get("fast")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let summary = summary.as_object();

    Ok(serde_json::json!({
        "schema": "haider.session_config.v1",
        "session_id": digest.get("session_id").cloned().unwrap_or(Value::Null),
        "title": digest.get("title").cloned().unwrap_or(Value::Null),
        "run_state": digest.get("run_state").cloned().unwrap_or(Value::Null),
        "provider": provider,
        "model": model,
        "effort": metadata.get("effort").cloned().unwrap_or(Value::Null),
        "speed": if fast { "fast" } else { "normal" },
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
        "subagent_count": digest.get("subagents").and_then(Value::as_array).map_or(0, Vec::len),
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
fn session_needs_input_available(connection: &ConnectionSnapshot) -> bool {
    connection.connected && connection.features.contains(FEATURE_SESSION_NEEDS_INPUT_V1)
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
    let option_index = session_answer_menu_attempt_option_index(
        &command_id,
        provider_session_id,
        &row.needs_input,
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
            Some(_) => Err("computer.permission_open_settings response method mismatch".to_string()),
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
        if !session_needs_input_available(&actor_handle().connection.borrow()) {
            return Err(HAIDER_NEEDS_INPUT_UNAVAILABLE.to_string());
        }
        let context_session_id = session_id;
        let context_menu_id = menu_id.clone();
        let context_option_key = option_key.clone();
        let (provider_session_id, option_index, command_id) =
            tauri::async_runtime::spawn_blocking(move || {
                session_answer_menu_context(
                    &context_session_id,
                    &context_menu_id,
                    request_seq,
                    worker_generation,
                    &context_option_key,
                )
            })
            .await
            .map_err(|error| format!("Session menu answer worker failed: {error}"))??;
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
        return match answer {
            Ok(Some(receipt)) => Ok(receipt),
            Ok(None) => Err(HAIDER_NEEDS_INPUT_UNAVAILABLE.to_string()),
            Err(SessionAnswerMenuRpcError::BeforeAnswer(error))
                if error.starts_with("missing_feature:") =>
            {
                Err(HAIDER_NEEDS_INPUT_UNAVAILABLE.to_string())
            }
            Err(SessionAnswerMenuRpcError::BeforeAnswer(error))
            | Err(SessionAnswerMenuRpcError::Answer(error)) => Err(error),
        };
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
) -> Result<Option<ResidentTurnSubmit>, String> {
    let Some(summary) = resident_turn_submit_session_summary(&session_id).await? else {
        return Ok(None);
    };
    let head_seq = config_u64(summary.get("head_seq"))
        .ok_or_else(|| "session summary head_seq was missing".to_string())?;
    let Some(response) = resident_turn_submit_request(RequestBody::SessionAttach {
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
        let _ = resident_turn_submit_request(RequestBody::SessionDetach { attachment_id }).await;
        return Err("session.attach response session mismatch".to_string());
    }

    let submit = async {
        let Some(response) = resident_turn_submit_request(RequestBody::TurnSubmitFromCli {
            command_id: resident_turn_submit_command_id(),
            session_id: session_id.clone(),
            worker_generation: attach_state.worker_generation,
            text: prompt,
            attachments: Vec::new(),
            mode: DeliveryMode::Queue,
        })
        .await?
        else {
            return Ok(None);
        };
        match response {
            ResponseBody::TurnSubmit {
                session_id: accepted_session,
                run_id,
                accepted_seq,
            } if accepted_session == session_id => Ok(Some(ResidentTurnSubmit {
                session_id: accepted_session,
                run_id,
                accepted_seq,
            })),
            ResponseBody::TurnSubmit { .. } => {
                Err("turn.submit response session mismatch".to_string())
            }
            _ => Err("turn.submit response method mismatch".to_string()),
        }
    }
    .await;

    let _ = resident_turn_submit_request(RequestBody::SessionDetach { attachment_id }).await;
    submit
}

/// Submits a text-only follow-up turn through the daemon-owned resident
/// connection. `None` means this connection cannot use the optional door;
/// callers must preserve the CLI submit fallback in that case.
pub(crate) async fn resident_turn_submit_rpc(
    session_id: String,
    prompt: String,
    attachments: Vec<String>,
) -> Option<Result<ResidentTurnSubmit, String>> {
    #[cfg(unix)]
    {
        if attachments
            .iter()
            .any(|attachment| !attachment.trim().is_empty())
        {
            return None;
        }
        return match resident_turn_submit_rpc_inner(session_id, prompt).await {
            Ok(Some(receipt)) => Some(Ok(receipt)),
            Ok(None) => None,
            Err(error) => Some(Err(error)),
        };
    }
    #[cfg(not(unix))]
    {
        let _ = (session_id, prompt, attachments);
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
async fn run_actor(
    mut commands: mpsc::UnboundedReceiver<ActorCommand>,
    connection_tx: watch::Sender<ConnectionSnapshot>,
) {
    let mut subscriptions: HashMap<String, Subscription> = HashMap::new();
    let mut last_published_revision: HashMap<String, u64> = HashMap::new();
    let mut roster_app = None;
    let mut reconnect_delay = Duration::from_millis(100);

    loop {
        while let Ok(command) = commands.try_recv() {
            apply_disconnected_command(
                command,
                &mut subscriptions,
                &mut last_published_revision,
                &mut roster_app,
            );
        }

        let resolved = resolve_socket_path();
        #[cfg(debug_assertions)]
        eprintln!("[ade-rpc] resolve -> {resolved:?}");
        let Some(socket_path) = resolved else {
            publish_disconnected(&connection_tx);
            if !wait_disconnected(
                &mut commands,
                &mut subscriptions,
                &mut last_published_revision,
                &mut roster_app,
                reconnect_delay,
            )
            .await
            {
                return;
            }
            reconnect_delay = (reconnect_delay * 2).min(Duration::from_secs(5));
            continue;
        };

        let attempt = tokio::time::timeout(HANDSHAKE_TIMEOUT, connect_and_handshake(&socket_path)).await;
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
            publish_disconnected(&connection_tx);
            if !wait_disconnected(
                &mut commands,
                &mut subscriptions,
                &mut last_published_revision,
                &mut roster_app,
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
        let mut snapshot = ConnectionSnapshot {
            connected: true,
            roster_watch_active: false,
            features: welcome.features.clone(),
            capabilities_granted: welcome.capabilities_granted.clone(),
            frame_limit: (welcome.frame_limit as usize).min(DEFAULT_FRAME_LIMIT),
        };
        ROSTER_WATCH_ACTIVE.store(false, Ordering::Release);
        let encoding = match WireEncoding::from_welcome(&welcome) {
            Ok(encoding) => encoding,
            Err(_) => {
                publish_disconnected(&connection_tx);
                continue;
            }
        };
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

        let _ = connection_tx.send(snapshot.clone());

        if !setup_failed {
            run_connected(
                &mut stream,
                snapshot,
                encoding,
                &mut commands,
                &mut subscriptions,
                &mut last_published_revision,
                &mut roster_app,
                &mut next_request,
            )
            .await;
        }
        publish_disconnected(&connection_tx);
    }
}

#[cfg(unix)]
fn publish_disconnected(connection_tx: &watch::Sender<ConnectionSnapshot>) {
    let mut snapshot = connection_tx.borrow().clone();
    snapshot.connected = false;
    snapshot.roster_watch_active = false;
    ROSTER_WATCH_ACTIVE.store(false, Ordering::Release);
    let _ = connection_tx.send(snapshot);
}

#[cfg(unix)]
async fn wait_disconnected(
    commands: &mut mpsc::UnboundedReceiver<ActorCommand>,
    subscriptions: &mut HashMap<String, Subscription>,
    last_published_revision: &mut HashMap<String, u64>,
    roster_app: &mut Option<AppHandle>,
    delay: Duration,
) -> bool {
    tokio::select! {
        command = commands.recv() => {
            let Some(command) = command else { return false; };
            apply_disconnected_command(command, subscriptions, last_published_revision, roster_app);
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
) {
    match command {
        ActorCommand::RosterAttach { app } => *roster_app = Some(app),
        ActorCommand::RpcRequest { reply, .. } => {
            let _ = reply.send(None);
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
                .entry(session_id)
                .and_modify(|subscription| subscription.app = app.clone())
                .or_insert_with(|| Subscription {
                    app,
                    revision_gate: RevisionGate::default(),
                });
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
    next_request: &mut u64,
) {
    let mut heartbeat = tokio::time::interval(PING_INTERVAL);
    heartbeat.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let mut ping_nonce = 1_u64;
    let mut unacked_pings: VecDeque<(u64, Instant)> = VecDeque::new();
    let mut pending_requests: HashMap<String, PendingRpcRequest> = HashMap::new();
    let mut decoder = StreamingFrameDecoder::default();
    let mut scratch = [0_u8; 16 * 1024];

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
                            &mut pending_requests,
                            next_request,
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
            WireFrame::SessionSurfaceDelta {
                session_id,
                input,
                status,
            } => {
                emit_surface(subscriptions, &connection, session_id, input, status);
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
    pending_requests: &mut HashMap<String, PendingRpcRequest>,
    next_request: &mut u64,
) -> bool {
    match command {
        ActorCommand::RosterAttach { app } => {
            *roster_app = Some(app);
            let active = connection.can_watch_roster();
            let written = !active
                || send_roster_watch(stream, connection.frame_limit, encoding, next_request)
                    .await
                    .is_ok();
            // Health stays pending until the first SessionRosterDelta lands.
            ROSTER_WATCH_ACTIVE.store(false, Ordering::Release);
            written
        }
        ActorCommand::RpcRequest {
            body,
            capability,
            features,
            public_errors,
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
            let error_style = if public_errors {
                RpcErrorStyle::Public
            } else {
                RpcErrorStyle::Detailed
            };
            pending_requests.insert(request_id, (reply, error_style));
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
                .or_insert_with(|| Subscription {
                    app,
                    revision_gate: RevisionGate::default(),
                });
            let active = connection.can_watch_surfaces();
            let written = !active
                || send_surface_watch(
                    stream,
                    connection.frame_limit,
                    encoding,
                    next_request,
                    session_id,
                )
                .await
                .is_ok();
            let _ = reply.send(SurfaceCommandStatus::from_connection(
                connection, active, written,
            ));
            written
        }
        ActorCommand::Detach { session_id, reply } => {
            subscriptions.remove(&session_id);
            let had_daemon_watch = connection.can_watch_surfaces();
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

#[cfg(unix)]
fn response_result(body: ResponseBody, error_style: RpcErrorStyle) -> Result<ResponseBody, String> {
    match body {
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
    let mut stream = UnixStream::connect(path).await?;
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
        _ => return Err(invalid_data("expected Haider Welcome frame")),
    };
    if welcome.protocol != WIRE_PROTOCOL_VERSION || welcome.frame_limit == 0 {
        return Err(invalid_data("invalid Haider Welcome negotiation"));
    }
    WireEncoding::from_welcome(&welcome)?;
    Ok((stream, welcome))
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

/// Resolves the published endpoint exactly like `haider-client`, then uses the
/// requested `.haiderd-*` newest-entry compatibility fallback if the
/// deterministic endpoint is absent.
fn resolve_socket_path() -> Option<PathBuf> {
    #[cfg(unix)]
    {
        let uid = unsafe { libc::geteuid() };
        let runtime_dir = runtime_dir(uid);
        let deterministic = deterministic_endpoint(
            std::env::var_os("HAIDER_PROFILE_DIR")
                .as_deref()
                .map(Path::new),
            std::env::var_os("HOME").as_deref().map(Path::new),
            &runtime_dir,
        );
        /* `exists()` was the original test and it is the wrong one: a stale
           socket file from a dead daemon exists just as well as a live one,
           so a single unlucky leftover pinned the ADE to an endpoint that
           could never answer. Require that it actually accepts. */
        if deterministic.as_ref().is_some_and(|path| socket_is_live(path)) {
            return deterministic;
        }
        let fallback_dir = PathBuf::from("/tmp").join(format!("haider-{uid}"));
        newest_live_endpoint(&fallback_dir)
            .or_else(|| newest_live_endpoint(&runtime_dir))
            .or(deterministic)
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
        metadata.is_dir() && metadata.uid() == uid && metadata.mode() & 0o077 == 0
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

/// A socket FILE proves nothing: the runtime dir accumulates one leftover per
/// daemon that ever ran (1259 of them on this machine), and a stale entry is
/// indistinguishable from a live one by name, mtime or metadata. Only a
/// connect answers the question, so candidates are probed newest-first and the
/// first one that accepts is the endpoint.
fn socket_is_live(path: &Path) -> bool {
    #[cfg(unix)]
    {
        std::os::unix::net::UnixStream::connect(path).is_ok()
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        false
    }
}

/// Endpoints appear under BOTH names: the daemon binds `.haiderd-<random>`
/// and renames it to `haider-<digest>.sock`, so at rest the staging name is
/// gone. Scanning only for staging found nothing and left the ADE permanently
/// unable to reach a running daemon.
fn endpoint_candidates(runtime_dir: &Path) -> Vec<PathBuf> {
    let mut found: Vec<(SystemTime, PathBuf)> = Vec::new();
    let Ok(entries) = std::fs::read_dir(runtime_dir) else {
        return Vec::new();
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let named = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| {
                name.starts_with(".haiderd-")
                    || (name.starts_with("haider-") && name.ends_with(".sock"))
            });
        if !named {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        found.push((modified, path));
    }
    found.sort_by(|left, right| right.0.cmp(&left.0).then_with(|| right.1.cmp(&left.1)));
    found.into_iter().map(|(_, path)| path).collect()
}

/// Newest-first, but bounded: probing every leftover would mean up to a
/// thousand connects on a cold resolve.
const ENDPOINT_PROBE_LIMIT: usize = 8;

fn newest_live_endpoint(runtime_dir: &Path) -> Option<PathBuf> {
    endpoint_candidates(runtime_dir)
        .into_iter()
        .take(ENDPOINT_PROBE_LIMIT)
        .find(|path| socket_is_live(path))
}

#[allow(dead_code)]
fn newest_staging_socket(runtime_dir: &Path) -> Option<PathBuf> {
    let mut newest: Option<(SystemTime, PathBuf)> = None;
    for entry in std::fs::read_dir(runtime_dir).ok()?.flatten() {
        let path = entry.path();
        let is_staging = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with(".haiderd-"));
        if !is_staging {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        if newest
            .as_ref()
            .is_none_or(|(best_time, best_path)| (modified, &path) > (*best_time, best_path))
        {
            newest = Some((modified, path));
        }
    }
    newest.map(|(_, path)| path)
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
mod tests {
    use super::*;

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
    fn resident_turn_submit_frame_matches_reference_json_bytes() {
        let submit = WireFrame::Request {
            request_id: "req-resident".to_owned(),
            body: RequestBody::TurnSubmitFromCli {
                command_id: "diffforge-resident-turn-test".to_owned(),
                session_id: "session-1".to_owned(),
                worker_generation: 7,
                text: "continue the work".to_owned(),
                attachments: Vec::new(),
                mode: DeliveryMode::Queue,
            },
        };
        let framed = encode_framed(&submit, DEFAULT_FRAME_LIMIT).expect("encode resident submit");
        assert_eq!(
            std::str::from_utf8(&framed[4..]).expect("resident submit JSON"),
            r#"{"v":1,"kind":"request","request_id":"req-resident","body":{"method":"turn.submit_from_cli","command_id":"diffforge-resident-turn-test","session_id":"session-1","worker_generation":7,"text":"continue the work","attachments":[],"mode":"queue"}}"#
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
                body: RequestBody::ProviderList {},
            }),
            r#"{"v":1,"kind":"request","request_id":"req-provider","body":{"method":"provider.list"}}"#
        );
        assert_eq!(
            encoded(WireFrame::Request {
                request_id: "req-observe".to_string(),
                body: RequestBody::SessionObserve {
                    session_id: "session-1".to_string(),
                    last_event_limit: 0,
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
        apply_disconnected_command(
            ActorCommand::RpcRequest {
                body: RequestBody::SessionList {
                    cursor: None,
                    limit: 256,
                },
                capability: Capability::View,
                features: FeatureGate::all(config_features(&[])),
                public_errors: false,
                reply,
            },
            &mut subscriptions,
            &mut revisions,
            &mut roster_app,
        );
        assert!(answer.try_recv().expect("fallback reply").is_none());
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
    fn menu_answer_requires_a_live_feature_advertisement() {
        let mut connection = ConnectionSnapshot {
            connected: true,
            features: BTreeSet::from([FEATURE_SESSION_NEEDS_INPUT_V1.to_string()]),
            ..ConnectionSnapshot::default()
        };
        assert!(session_needs_input_available(&connection));

        connection.features.clear();
        assert!(!session_needs_input_available(&connection));

        connection
            .features
            .insert(FEATURE_SESSION_NEEDS_INPUT_V1.to_string());
        connection.connected = false;
        assert!(!session_needs_input_available(&connection));
    }

    #[test]
    fn socket_path_resolution_matches_profile_hash_and_newest_fallback() {
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

        let older = runtime.join(".haiderd-older");
        let newer = runtime.join(".haiderd-newer");
        std::fs::write(&older, []).expect("older fallback");
        std::thread::sleep(Duration::from_millis(20));
        std::fs::write(&newer, []).expect("newer fallback");
        assert_eq!(newest_staging_socket(&runtime), Some(newer));

        std::fs::remove_dir_all(root).expect("remove test directory");
    }

    #[cfg(unix)]
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
        ] {
            assert!(
                welcome.features.contains(feature),
                "daemon {} did not advertise {feature}",
                welcome.daemon_version
            );
        }
    }
}

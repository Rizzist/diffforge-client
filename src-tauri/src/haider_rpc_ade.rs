//! Minimal ADE client for Haider's daemon-owned volatile session surfaces.
//!
//! This module deliberately mirrors the stable JSON subset of `haider-rpc`
//! instead of depending on the Haider workspace. Unix-domain frames are a
//! four-byte big-endian body length followed by one JSON `WireFrame`.

use std::{
    collections::{BTreeSet, HashMap},
    path::{Path, PathBuf},
    sync::OnceLock,
    time::{Duration, SystemTime},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot, watch};

#[cfg(unix)]
use std::collections::VecDeque;

#[cfg(unix)]
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::UnixStream,
    time::{Instant, MissedTickBehavior},
};

const WIRE_PROTOCOL_VERSION: u32 = 1;
const DEFAULT_FRAME_LIMIT: usize = 48 * 1024 * 1024;
const FEATURE_INPUT_MIRROR_V1: &str = "input_mirror_v1";
const FEATURE_STATUS_SEGMENT_V1: &str = "status_segment_v1";
const FEATURE_SESSION_LIST_WATCH_V1: &str = "session_list_watch_v1";
const FEATURE_SESSION_CONFIG_V1: &str = "session_config_v1";
const FEATURE_SESSION_OBSERVE_V1: &str = "session_observe_v1";
const FEATURE_SESSION_MODEL_SELECT_V1: &str = "session_model_select_v1";
const FEATURE_SESSION_EFFORT_SELECT_V1: &str = "session_effort_select_v1";
const FEATURE_SESSION_FAST_SELECT_V1: &str = "session_fast_select_v1";
const FEATURE_SESSION_ACCOUNT_SELECT_V1: &str = "session_account_select_v1";
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
    pub revision: u64,
    /// Daemon-stamped publisher connection id. Revision lanes are
    /// PER-CONNECTION, so the UI must discriminate self/foreign by owner —
    /// never by comparing revisions across lanes (rev934 P1-1).
    pub owner: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SurfaceStatus {
    pub line: String,
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
    revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct SurfaceStatusPublishWire {
    line: String,
    revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct SurfaceInputWire {
    text: String,
    revision: u64,
    #[serde(default)]
    owner: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct SurfaceStatusWire {
    line: String,
    revision: u64,
    #[serde(default)]
    owner: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "method")]
enum RequestBody {
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
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "method")]
enum ResponseBody {
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

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum AttachMode {
    Control,
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

fn versioned(frame: WireFrame) -> VersionedFrame {
    VersionedFrame {
        version: WIRE_PROTOCOL_VERSION,
        frame,
    }
}

fn encode_framed(frame: &WireFrame, frame_limit: usize) -> std::io::Result<Vec<u8>> {
    let body = serde_json::to_vec(&versioned(frame.clone())).map_err(invalid_data)?;
    if body.is_empty() || body.len() > frame_limit || body.len() > u32::MAX as usize {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Haider RPC frame exceeds the negotiated limit",
        ));
    }
    let mut framed = Vec::with_capacity(4 + body.len());
    framed.extend_from_slice(&(body.len() as u32).to_be_bytes());
    framed.extend_from_slice(&body);
    Ok(framed)
}

fn decode_body(body: &[u8], frame_limit: usize) -> std::io::Result<WireFrame> {
    if body.is_empty() || body.len() > frame_limit {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "invalid Haider RPC frame length",
        ));
    }
    let decoded: VersionedFrame = serde_json::from_slice(body).map_err(invalid_data)?;
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
        // Empty is encoded by omission and keeps the post-handshake stream JSON.
        encodings: Vec::new(),
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
    features: BTreeSet<String>,
    capabilities_granted: BTreeSet<Capability>,
    frame_limit: usize,
}

#[cfg(unix)]
impl ConnectionSnapshot {
    fn can_watch_surfaces(&self) -> bool {
        self.connected
            && self.capabilities_granted.contains(&Capability::View)
            && (self.features.contains(FEATURE_INPUT_MIRROR_V1)
                || self.features.contains(FEATURE_STATUS_SEGMENT_V1))
    }

    fn can_publish_input(&self) -> bool {
        self.connected
            && self.capabilities_granted.contains(&Capability::Control)
            && self.features.contains(FEATURE_INPUT_MIRROR_V1)
    }

    fn can_watch_roster(&self) -> bool {
        self.connected
            && self.capabilities_granted.contains(&Capability::View)
            && self.features.contains(FEATURE_SESSION_LIST_WATCH_V1)
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
enum ActorCommand {
    RosterAttach {
        app: AppHandle,
    },
    RpcRequest {
        body: RequestBody,
        capability: Capability,
        features: BTreeSet<String>,
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
    revision: u64,
) -> Result<SurfaceCommandStatus, String> {
    #[cfg(unix)]
    {
        let handle = actor_handle();
        let (reply, answer) = oneshot::channel();
        if handle
            .commands
            .send(ActorCommand::PublishInput {
                session_id,
                text,
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
        let _ = (session_id, text, revision);
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

#[cfg(unix)]
async fn rpc_request(
    body: RequestBody,
    capability: Capability,
    features: BTreeSet<String>,
) -> Option<Result<ResponseBody, String>> {
    let (reply, answer) = oneshot::channel();
    actor_handle()
        .commands
        .send(ActorCommand::RpcRequest {
            body,
            capability,
            features,
            reply,
        })
        .ok()?;
    tokio::time::timeout(COMMAND_REPLY_TIMEOUT, answer)
        .await
        .ok()?
        .ok()?
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

        let Some(socket_path) = resolve_socket_path() else {
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

        let connected =
            tokio::time::timeout(HANDSHAKE_TIMEOUT, connect_and_handshake(&socket_path))
                .await
                .ok()
                .and_then(Result::ok);
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
        let snapshot = ConnectionSnapshot {
            connected: true,
            features: welcome.features.clone(),
            capabilities_granted: welcome.capabilities_granted.clone(),
            frame_limit: (welcome.frame_limit as usize).min(DEFAULT_FRAME_LIMIT),
        };
        let _ = connection_tx.send(snapshot.clone());

        let mut next_request = 1_u64;
        let mut setup_failed = false;
        if roster_app.is_some()
            && snapshot.can_watch_roster()
            && send_roster_watch(&mut stream, snapshot.frame_limit, &mut next_request)
                .await
                .is_err()
        {
            setup_failed = true;
        }
        if snapshot.can_watch_surfaces() {
            let session_ids = subscriptions.keys().cloned().collect::<Vec<_>>();
            for session_id in session_ids {
                if send_surface_watch(
                    &mut stream,
                    snapshot.frame_limit,
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

        if !setup_failed {
            run_connected(
                &mut stream,
                snapshot,
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
    let mut pending_requests: HashMap<String, RpcReply> = HashMap::new();

    loop {
        tokio::select! {
            command = commands.recv() => {
                let Some(command) = command else { return; };
                let keep_connection = apply_connected_command(
                    command,
                    stream,
                    &connection,
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
            frame = read_frame(stream, connection.frame_limit) => {
                let Ok(frame) = frame else { return; };
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
                        if let Some(reply) = pending_requests.remove(&request_id) {
                            let _ = reply.send(Some(response_result(body)));
                        }
                    }
                    WireFrame::SessionRosterDelta { summaries } => {
                        if let Some(app) = roster_app.as_ref() {
                            super::haider_bridge_reconcile_from_summaries(app.clone(), summaries);
                        }
                    }
                    WireFrame::SessionSurfaceDelta { session_id, input, status } => {
                        emit_surface(subscriptions, &connection, session_id, input, status);
                    }
                    WireFrame::Ping { nonce } => {
                        if write_frame(stream, &WireFrame::Pong { nonce }, connection.frame_limit)
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
    }
}

#[cfg(unix)]
async fn apply_connected_command(
    command: ActorCommand,
    stream: &mut UnixStream,
    connection: &ConnectionSnapshot,
    subscriptions: &mut HashMap<String, Subscription>,
    last_published_revision: &mut HashMap<String, u64>,
    roster_app: &mut Option<AppHandle>,
    pending_requests: &mut HashMap<String, RpcReply>,
    next_request: &mut u64,
) -> bool {
    match command {
        ActorCommand::RosterAttach { app } => {
            *roster_app = Some(app);
            !connection.can_watch_roster()
                || send_roster_watch(stream, connection.frame_limit, next_request)
                    .await
                    .is_ok()
        }
        ActorCommand::RpcRequest {
            body,
            capability,
            features,
            reply,
        } => {
            if !connection.capabilities_granted.contains(&capability) {
                let _ = reply.send(Some(Err(format!(
                    "Haider RPC connection does not grant {capability:?} capability"
                ))));
                return true;
            }
            if !features.is_subset(&connection.features) {
                let missing = features
                    .difference(&connection.features)
                    .cloned()
                    .collect::<Vec<_>>()
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
            if write_frame(stream, &request, connection.frame_limit)
                .await
                .is_err()
            {
                let _ = reply.send(None);
                return false;
            }
            pending_requests.insert(request_id, reply);
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
                || send_surface_watch(stream, connection.frame_limit, next_request, session_id)
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
            revision,
            reply,
        } => {
            let active = connection.can_publish_input();
            let fresh = last_published_revision
                .get(&session_id)
                .is_none_or(|previous| revision > *previous);
            let written = if active && fresh {
                let request = WireFrame::Request {
                    request_id: request_id(next_request),
                    body: RequestBody::SessionSurfacePublish {
                        session_id: session_id.clone(),
                        input: Some(SurfaceInputPublishWire { text, revision }),
                        status: None,
                    },
                };
                write_frame(stream, &request, connection.frame_limit)
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
    let input = connection
        .features
        .contains(FEATURE_INPUT_MIRROR_V1)
        .then_some(input)
        .flatten();
    let status = connection
        .features
        .contains(FEATURE_STATUS_SEGMENT_V1)
        .then_some(status)
        .flatten();
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

#[cfg(unix)]
fn response_result(body: ResponseBody) -> Result<ResponseBody, String> {
    match body {
        ResponseBody::Error {
            code,
            message,
            retryable,
            ..
        } => Err(format!(
            "daemon rejected session config ({code}, retryable={retryable}): {message}"
        )),
        response => Ok(response),
    }
}

#[cfg(unix)]
async fn send_roster_watch(
    stream: &mut UnixStream,
    frame_limit: usize,
    next_request: &mut u64,
) -> std::io::Result<()> {
    let request = WireFrame::Request {
        request_id: request_id(next_request),
        body: RequestBody::SessionListWatch {},
    };
    write_frame(stream, &request, frame_limit).await
}

#[cfg(unix)]
async fn send_surface_watch(
    stream: &mut UnixStream,
    frame_limit: usize,
    next_request: &mut u64,
    session_id: String,
) -> std::io::Result<()> {
    let request = WireFrame::Request {
        request_id: request_id(next_request),
        body: RequestBody::SessionSurfaceWatch { session_id },
    };
    write_frame(stream, &request, frame_limit).await
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
    write_frame(&mut stream, &hello_frame(), DEFAULT_FRAME_LIMIT).await?;
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
    if welcome
        .encoding
        .as_deref()
        .is_some_and(|encoding| encoding != "json")
    {
        return Err(invalid_data(
            "daemon selected a non-JSON encoding that the ADE did not offer",
        ));
    }
    Ok((stream, welcome))
}

#[cfg(unix)]
async fn write_frame(
    stream: &mut UnixStream,
    frame: &WireFrame,
    frame_limit: usize,
) -> std::io::Result<()> {
    let bytes = encode_framed(frame, frame_limit)?;
    stream.write_all(&bytes).await
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
        if deterministic.as_ref().is_some_and(|path| path.exists()) {
            return deterministic;
        }
        let fallback_dir = PathBuf::from("/tmp").join(format!("haider-{uid}"));
        newest_staging_socket(&fallback_dir)
            .or_else(|| newest_staging_socket(&runtime_dir))
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
        assert!(hello_json.get("encodings").is_none());

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
                revision: 4,
                owner: "tui".to_owned(),
            }),
            Some(SurfaceStatusWire {
                line: "working".to_owned(),
                revision: 9,
                owner: "tui".to_owned(),
            }),
        );
        assert!(fresh.is_some());

        assert!(gate
            .accept(
                Some(SurfaceInputWire {
                    text: "equal".to_owned(),
                    revision: 4,
                    owner: "tui".to_owned(),
                }),
                Some(SurfaceStatusWire {
                    line: "older".to_owned(),
                    revision: 8,
                    owner: "tui".to_owned(),
                }),
            )
            .is_none());

        let (input, status) = gate
            .accept(
                Some(SurfaceInputWire {
                    text: "new".to_owned(),
                    revision: 5,
                    owner: "tui".to_owned(),
                }),
                Some(SurfaceStatusWire {
                    line: "still stale".to_owned(),
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
                    revision: 1,
                    owner: "ade".to_owned(),
                }),
                Some(SurfaceStatusWire {
                    line: "still stale".to_owned(),
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
                features: config_features(&[]),
                reply,
            },
            &mut subscriptions,
            &mut revisions,
            &mut roster_app,
        );
        assert!(answer.try_recv().expect("fallback reply").is_none());
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

//! Wake-command intake for the device email stack (contract §9.4, plan
//! §4.3). The load-bearing law: the device durably journals
//! `(send_job_id, generation, command_id, payload_hash)` BEFORE emitting the
//! `remote_command_ack {accepted|duplicate|rejected, first_status_event_id?}`
//! — in BOTH live intake and account-sync-resume replay.
//!
//! This module is pure enough to unit-test: `classify_send_intake` maps a
//! journal `CommandIntake` to the ack shape without any cloud I/O. The
//! `WsCloudTransport`-facing glue lives in cloud_mcp.rs, which calls
//! `email_intake_ack_payload` after the journal write commits.

use serde_json::{json, Value};

use super::contract::{
    self, email_command_payload_hash, is_email_command_kind, parse_email_command, EmailCommand,
    EMAIL_GENERATION_RETIRED_KIND,
};
use super::journal::{CommandIntake, EmailJournal};

/// The ack a completed journal write authorizes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IntakeAck {
    pub result: String, // accepted | duplicate | rejected
    pub first_status_event_id: Option<String>,
    /// Set when the redelivery hash differs from the journaled one — a
    /// security rejection (§10.1). The command is NOT executed.
    pub security_rejected: bool,
}

impl IntakeAck {
    pub fn accepted(first_status_event_id: String) -> Self {
        IntakeAck {
            result: "accepted".to_string(),
            first_status_event_id: Some(first_status_event_id).filter(|id| !id.is_empty()),
            security_rejected: false,
        }
    }
    pub fn duplicate(first_status_event_id: Option<String>) -> Self {
        IntakeAck {
            result: "duplicate".to_string(),
            first_status_event_id,
            security_rejected: false,
        }
    }
    pub fn rejected(security: bool) -> Self {
        IntakeAck {
            result: "rejected".to_string(),
            first_status_event_id: None,
            security_rejected: security,
        }
    }

    /// Whether the command should proceed to execution after this ack.
    pub fn should_execute(&self) -> bool {
        self.result == "accepted"
    }
}

/// Map a journal intake outcome to the §9.4 ack. Pure — the journal write
/// has already committed before this runs.
pub fn classify_send_intake(intake: &CommandIntake) -> IntakeAck {
    match intake {
        CommandIntake::Accepted {
            first_status_event_id,
        } => IntakeAck::accepted(first_status_event_id.clone()),
        CommandIntake::Duplicate {
            first_status_event_id,
        } => IntakeAck::duplicate(first_status_event_id.clone()),
        CommandIntake::Tombstoned { .. } => IntakeAck::duplicate(None),
        CommandIntake::SecurityRejected { .. } => IntakeAck::rejected(true),
        CommandIntake::FencedByHigherGeneration { .. } => IntakeAck::rejected(false),
    }
}

/// Build the §9.2 phase-received event payload at intake time — rank-1
/// fields only (no mode/lease/mime). Journaled ATOMICALLY with the receipt
/// and job row so the ack's `first_status_event_id` always references a
/// durable event, even if the process dies between ack and worker.
pub fn received_event_payload(
    command: &EmailCommand,
    device_id: &str,
    status_event_id: &str,
) -> Value {
    let EmailCommand::Send {
        command_id,
        send_job_id,
        generation,
        binding_id,
        ..
    } = command
    else {
        return Value::Null;
    };
    json!({
        "contract": contract::EMAIL_CONTRACT,
        "schema_version": contract::EMAIL_SCHEMA_VERSION,
        "status_event_id": status_event_id,
        "command_id": command_id,
        "send_job_id": send_job_id,
        "generation": generation,
        "device_id": device_id,
        "binding_id": binding_id,
        "phase": "received",
        "phase_rank": contract::SendPhase::Received.rank(),
        "occurred_at_ms": now_ms(),
    })
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

/// Journal a wake/companion command and return the ack. This is the single
/// entry both intake paths call — the journal write commits inside here,
/// strictly BEFORE the returned ack is emitted by the caller.
pub fn journal_command_before_ack(
    journal: &mut EmailJournal,
    command: &EmailCommand,
    source: &str,
    device_id: &str,
) -> Result<IntakeAck, String> {
    let payload_hash = email_command_payload_hash(command);
    let ack = match command {
        EmailCommand::Send {
            command_id,
            send_job_id,
            generation,
            binding_id,
            ..
        } => {
            let intake = journal.record_send_command(
                send_job_id,
                *generation,
                command_id,
                binding_id,
                &payload_hash,
                source,
                |status_event_id| received_event_payload(command, device_id, status_event_id),
            )?;
            classify_send_intake(&intake)
        }
        EmailCommand::CredentialProbe { command_id, .. }
        | EmailCommand::PreflightRun { command_id, .. } => {
            let intake = journal.record_companion_command(command_id, &payload_hash, source)?;
            classify_send_intake(&intake)
        }
    };
    // The journal write above has COMMITTED; the ack the caller emits next
    // is authorized. A crash exactly here must leave a journaled receipt
    // with no ack — the redelivery dedupes and re-acks (crash matrix:
    // "pre-transport ack").
    super::email_killpoint("post_receipt_pre_ack");
    Ok(ack)
}

/// The durable `remote_command_ack` payload (§9.4) — kind/id parts form, so
/// the fail-closed rejection of a malformed command (which never parses into
/// an `EmailCommand`) builds the SAME shape.
pub fn email_intake_ack_payload_parts(
    command_kind: &str,
    command_id: &str,
    ack: &IntakeAck,
    device_id: &str,
    target_device_id: &str,
) -> Value {
    let mut payload = json!({
        "contract": contract::EMAIL_CONTRACT,
        "schema_version": contract::EMAIL_SCHEMA_VERSION,
        "event_kind": "remote_command_ack",
        "command_id": command_id,
        "command_kind": command_kind,
        "status": ack.result,
        "ack": ack.result,
        "device_id": device_id,
        "target_device_id": target_device_id,
        "source": "rust-diffforge-email-intake",
    });
    if let Some(first) = ack.first_status_event_id.as_ref() {
        payload["first_status_event_id"] = json!(first);
        // The outbox idempotency key for remote_command_ack incorporates a
        // status_event_id; supply it so retries dedupe.
        payload["status_event_id"] = json!(first);
    }
    payload
}

/// The durable `remote_command_ack` payload (§9.4). Enqueued to the outbox
/// AFTER the journal write, carrying the ack result + first_status_event_id.
pub fn email_intake_ack_payload(
    command: &EmailCommand,
    ack: &IntakeAck,
    device_id: &str,
    target_device_id: &str,
) -> Value {
    email_intake_ack_payload_parts(
        command.kind(),
        command.command_id(),
        ack,
        device_id,
        target_device_id,
    )
}

/// Uniform checked send-generation parse (§1: bounded u32, starts at 1) —
/// the ONE conversion every generation-bearing path uses (reviews
/// R2-10/R3-11/R4-4): missing, zero, or out-of-range values are errors,
/// never defaults or aliases.
pub(crate) fn checked_generation(raw: u64) -> Result<u32, String> {
    u32::try_from(raw)
        .ok()
        .filter(|generation| *generation >= 1)
        .ok_or_else(|| format!("generation out of range (must be 1..=u32::MAX): {raw}"))
}

/// True when the event's kind names `email_generation_retired` — the strict
/// parse below decides whether it is well-formed.
pub fn is_generation_retired_event(event: &Value) -> bool {
    event
        .get("kind")
        .or_else(|| event.get("event_kind"))
        .and_then(Value::as_str)
        == Some(EMAIL_GENERATION_RETIRED_KIND)
}

/// Strict parse of the cloud→device `email_generation_retired` ack (§9.4):
/// exact contract + schema envelope, generation accepted as JSON number or
/// §0.2 decimal string with a CHECKED u64→u32 conversion (no aliasing —
/// 2^32+1 is an error, never generation 1).
pub fn parse_generation_retired(event: &Value) -> Result<(String, u32), String> {
    if !is_generation_retired_event(event) {
        return Err("not an email_generation_retired event".to_string());
    }
    let contract_ok = event
        .get("contract")
        .and_then(Value::as_str)
        .is_some_and(|value| value == contract::EMAIL_CONTRACT);
    let schema_ok = event
        .get("schema_version")
        .and_then(Value::as_u64)
        .is_some_and(|value| value == u64::from(contract::EMAIL_SCHEMA_VERSION));
    if !contract_ok || !schema_ok {
        return Err("generation_retired envelope fails closed (contract/schema)".to_string());
    }
    let send_job_id = event
        .get("send_job_id")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "generation_retired missing send_job_id".to_string())?
        .to_string();
    let raw = match event.get("generation") {
        Some(Value::Number(number)) => number
            .as_u64()
            .ok_or_else(|| "generation_retired generation not unsigned".to_string())?,
        Some(value @ Value::String(_)) => contract::u64_from_wire(value)?,
        _ => return Err("generation_retired missing generation".to_string()),
    };
    let generation = checked_generation(raw)?;
    Ok((send_job_id, generation))
}

/// Tri-state classification of a remote-command event (§9.4): not an email
/// command at all, a valid one, or a RECOGNIZED-but-invalid one. The invalid
/// case must be consumed with a fail-closed rejection — it must never fall
/// through to the generic acknowledgement pipeline as if it were unknown.
pub enum EmailCommandEvent {
    NotEmail,
    Valid(EmailCommand),
    Invalid {
        kind: String,
        command_id: Option<String>,
        error: String,
    },
}

pub fn classify_email_command_event(event: &Value) -> EmailCommandEvent {
    let Some(kind) = event
        .get("command_kind")
        .or_else(|| {
            event
                .get("payload")
                .and_then(|inner| inner.get("command_kind"))
        })
        .and_then(Value::as_str)
    else {
        return EmailCommandEvent::NotEmail;
    };
    if !is_email_command_kind(kind) {
        return EmailCommandEvent::NotEmail;
    }
    match parse_email_command(kind, event) {
        Ok(command) => EmailCommandEvent::Valid(command),
        Err(error) => EmailCommandEvent::Invalid {
            kind: kind.to_string(),
            command_id: event
                .get("command_id")
                .or_else(|| {
                    event
                        .get("payload")
                        .and_then(|inner| inner.get("command_id"))
                })
                .and_then(Value::as_str)
                .map(str::to_string),
            error,
        },
    }
}

/// Extract the command kind from a remote-command event (root or nested).
pub fn event_email_command(event: &Value) -> Option<EmailCommand> {
    match classify_email_command_event(event) {
        EmailCommandEvent::Valid(command) => Some(command),
        _ => None,
    }
}

/// True when this event is an email wake/companion command — used by the
/// dispatcher's rust-owned matcher so the generic UI-emit path is skipped.
pub fn is_email_command_event(event: &Value) -> bool {
    event
        .get("command_kind")
        .or_else(|| {
            event
                .get("payload")
                .and_then(|inner| inner.get("command_kind"))
        })
        .and_then(Value::as_str)
        .is_some_and(is_email_command_kind)
}

// ---------------------------------------------------------------------
// Runtime glue (cloud_mcp integration). These functions are the ONLY email
// entry points cloud_mcp.rs calls; they run the journal writes on blocking
// threads and never ack before the journal commit returns.
// ---------------------------------------------------------------------

/// Send the DEDICATED §9.4 `remote_command_ack` — contract + schema at the
/// root, top-level `first_status_event_id`, result in `status`/`ack`. Rides
/// the durable outbox (idempotent per command + result) AND a best-effort
/// live send. `rejected` also travels as `remote_command_ack` — never as a
/// generic `remote_command_result`.
async fn send_email_command_ack(
    state: &crate::CloudMcpState,
    command_kind: &str,
    command_id: &str,
    ack: &IntakeAck,
    reject_reason: Option<&str>,
    device_id: &str,
    target_device_id: &str,
) {
    let mut payload =
        email_intake_ack_payload_parts(command_kind, command_id, ack, device_id, target_device_id);
    payload["ts_ms"] = json!(now_ms());
    if let Some(reason) = reject_reason {
        // Local diagnostic only — deliberately NOT named `error_class`, which
        // is a §9.2 closed enum with different members.
        payload["reject_reason"] = json!(reason);
    }
    let idempotency_key = format!("email-command-ack:{command_id}:{}", ack.result);
    payload["idempotency_key"] = json!(idempotency_key.clone());
    crate::cloud_mcp_enqueue_background_sync(
        state,
        idempotency_key,
        "remote_command_ack",
        payload.clone(),
        crate::cloud_mcp_outbox_priority_for_event("remote_command_ack"),
        "email_command_ack",
    )
    .await;
    let _ = crate::cloud_mcp_send_event_over_app_ws_once(
        state,
        "remote_command_ack",
        &payload,
        "email-intake-ack-live",
    )
    .await;
}

/// Handle an email wake/companion command from EITHER intake path
/// (`live_intake` or `account_sync_resume_replay`). Returns true when the
/// event was a RECOGNIZED email command — valid or not — so the generic
/// pipeline never acknowledges a malformed email command as if it were an
/// ordinary one.
pub async fn email_try_handle_remote_command(
    state: &crate::CloudMcpState,
    event: &Value,
    source: &'static str,
) -> bool {
    let device_id = crate::cloud_mcp_email_device_id();
    let command = match classify_email_command_event(event) {
        EmailCommandEvent::NotEmail => return false,
        EmailCommandEvent::Invalid {
            kind,
            command_id,
            error,
        } => {
            // A recognized-but-malformed email command is consumed with a
            // fail-closed rejection ack (no journal receipt — nothing may
            // execute, and redelivery re-rejects identically).
            crate::log_terminal_status_event(
                "backend.email.command_invalid",
                json!({
                    "command_kind": kind,
                    "command_id": command_id,
                    "source": source,
                    "error": error,
                }),
            );
            if let Some(command_id) = command_id.as_deref() {
                send_email_command_ack(
                    state,
                    &kind,
                    command_id,
                    &IntakeAck::rejected(false),
                    Some("invalid_payload"),
                    &device_id,
                    &device_id,
                )
                .await;
            }
            return true;
        }
        EmailCommandEvent::Valid(command) => command,
    };

    // 1) Journal BEFORE ack (§9.4). A journal failure means NO ack of ANY
    // kind — the command was not durably received, so the device stays
    // silent and the cloud's at-least-once redelivery retries later.
    let journal_command = command.clone();
    let journal_device_id = device_id.clone();
    let intake = tauri::async_runtime::spawn_blocking(move || {
        let mut journal = EmailJournal::open_default()?;
        journal_command_before_ack(&mut journal, &journal_command, source, &journal_device_id)
    })
    .await
    .map_err(|error| format!("email intake join failed: {error}"));
    let ack = match intake {
        Ok(Ok(ack)) => ack,
        Ok(Err(error)) | Err(error) => {
            crate::log_terminal_status_event(
                "backend.email.intake_journal_failed",
                json!({
                    "command_id": command.command_id(),
                    "source": source,
                    "error": error,
                }),
            );
            return true;
        }
    };

    // 2) The dedicated §9.4 ack, authorized by the committed journal write.
    let target_device_id = event
        .get("target_device_id")
        .or_else(|| {
            event
                .get("payload")
                .and_then(|inner| inner.get("target_device_id"))
        })
        .and_then(Value::as_str)
        .unwrap_or(&device_id)
        .to_string();
    let reject_reason = if ack.result == "rejected" {
        Some(if ack.security_rejected {
            "security_rejected"
        } else {
            "fenced_by_higher_generation"
        })
    } else {
        None
    };
    send_email_command_ack(
        state,
        command.kind(),
        command.command_id(),
        &ack,
        reject_reason,
        &device_id,
        &target_device_id,
    )
    .await;
    if ack.security_rejected {
        crate::log_terminal_status_event(
            "backend.email.command_hash_mismatch",
            json!({ "command_id": command.command_id(), "source": source }),
        );
    }

    // 3) Execute. Accepted commands always run; a DUPLICATE email_send whose
    // journal state is still non-terminal is a cloud re-offer — re-kick the
    // worker (same generation re-executes after lease expiry /
    // credential_required recovery, §6b.1). The worker holds the atomic
    // per-generation claim, so a duplicate spawn can never race the first
    // into a second SMTP transaction.
    match &command {
        EmailCommand::Send {
            send_job_id,
            generation,
            ..
        } => {
            if ack.should_execute() || ack.result == "duplicate" {
                spawn_send_worker(state.clone(), send_job_id.clone(), *generation, device_id);
            }
        }
        EmailCommand::CredentialProbe { profile_ref, .. } => {
            if ack.should_execute() {
                run_credential_probe(state, event, profile_ref.clone()).await;
            }
        }
        EmailCommand::PreflightRun {
            profile_ref,
            domain,
            requested_checks,
            ..
        } => {
            if ack.should_execute() {
                run_preflight_snapshot(
                    state,
                    profile_ref.clone(),
                    domain.clone(),
                    requested_checks.clone(),
                    device_id,
                )
                .await;
            }
        }
    }
    true
}

/// Handle cloud→device email ws events that are NOT remote commands — today
/// the §9.4 `email_generation_retired` ack, which unlocks tombstone
/// compaction (§10.1). Returns true when consumed (including malformed
/// retirement events, which are logged and dropped fail-closed).
pub async fn email_try_handle_ws_event(_event_kind: &str, event: &Value) -> bool {
    if !is_generation_retired_event(event) {
        return false;
    }
    let (send_job_id, generation) = match parse_generation_retired(event) {
        Ok(parsed) => parsed,
        Err(error) => {
            crate::log_terminal_status_event(
                "backend.email.generation_retired_malformed",
                json!({ "error": error }),
            );
            return true;
        }
    };
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut journal = EmailJournal::open_default()?;
        let matched = journal.record_generation_retired(&send_job_id, generation)?;
        let compacted = journal.compact_retired_tombstones()?;
        Ok::<(bool, u32), String>((matched, compacted))
    })
    .await;
    if let Ok(Err(error)) = result {
        crate::log_terminal_status_event(
            "backend.email.generation_retired_failed",
            json!({ "error": error }),
        );
    }
    true
}

/// Atomic per-(send_job_id, generation) worker claim: at most ONE send
/// worker per pair per process. Duplicate wake commands re-kick the worker,
/// and without this claim two spawns could interleave their SMTP
/// transactions and cross DATA twice for the same generation.
static ACTIVE_SEND_WORKERS: std::sync::Mutex<std::collections::BTreeSet<(String, u32)>> =
    std::sync::Mutex::new(std::collections::BTreeSet::new());

pub(crate) struct SendWorkerClaim {
    key: (String, u32),
}

impl Drop for SendWorkerClaim {
    fn drop(&mut self) {
        if let Ok(mut active) = ACTIVE_SEND_WORKERS.lock() {
            active.remove(&self.key);
        }
    }
}

pub(crate) fn claim_send_worker(send_job_id: &str, generation: u32) -> Option<SendWorkerClaim> {
    let key = (send_job_id.to_string(), generation);
    let mut active = ACTIVE_SEND_WORKERS.lock().ok()?;
    if !active.insert(key.clone()) {
        return None;
    }
    Some(SendWorkerClaim { key })
}

/// Spawn the send worker for one (send_job_id, generation) on a blocking
/// thread, panic-caught per the self-restarting worker shape — a panic is
/// logged and the pair is left to the resume path (never silently lost).
pub fn spawn_send_worker(
    state: crate::CloudMcpState,
    send_job_id: String,
    generation: u32,
    device_id: String,
) {
    tauri::async_runtime::spawn_blocking(move || {
        let run = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            run_send_worker_once(&state, &send_job_id, generation, &device_id)
        }));
        match run {
            Ok(Ok(result)) => {
                crate::log_terminal_status_event(
                    "backend.email.send_worker_finished",
                    json!({
                        "send_job_id": send_job_id,
                        "generation": generation,
                        "result": format!("{result:?}"),
                    }),
                );
            }
            Ok(Err(error)) => {
                crate::log_terminal_status_event(
                    "backend.email.send_worker_error",
                    json!({
                        "send_job_id": send_job_id,
                        "generation": generation,
                        "error": error,
                    }),
                );
            }
            Err(_panic) => {
                crate::log_terminal_status_event(
                    "backend.email.send_worker_panicked",
                    json!({
                        "send_job_id": send_job_id,
                        "generation": generation,
                        "restart": "resume_path",
                    }),
                );
            }
        }
    });
}

fn run_send_worker_once(
    state: &crate::CloudMcpState,
    send_job_id: &str,
    generation: u32,
    device_id: &str,
) -> Result<super::submission::SubmissionResult, String> {
    use super::cloud_transport::{EmailCloudTransport, WsCloudTransport};
    use super::credentials::CredentialStack;
    use super::submission::{run_send_job, SubmissionDeps};

    // Atomic per-generation claim: a second worker for the same pair (a
    // duplicate wake racing the first) exits immediately instead of running
    // a parallel SMTP transaction.
    let Some(_claim) = claim_send_worker(send_job_id, generation) else {
        return Ok(super::submission::SubmissionResult::NotRunnable(
            "worker_already_active".to_string(),
        ));
    };

    let mut journal = EmailJournal::open_default()?;
    let transport = WsCloudTransport {
        state: state.clone(),
    };
    // Flush pending journal events for this pair first — this hands off the
    // intake-journaled `received` event (the ack's first_status_event_id)
    // and, on duplicate redelivery after a crash, any event the previous
    // incarnation journaled but never handed to the outbox.
    for event in journal.pending_events_for(send_job_id, generation)? {
        if transport.emit_send_event(&event.payload).is_ok() {
            journal.mark_event_handed_off(&event.status_event_id)?;
        }
    }
    let secrets = CredentialStack::new();
    let deps = SubmissionDeps {
        transport: &transport,
        secrets: &secrets,
        device_id: device_id.to_string(),
        extra_root_cert_pem: None,
        connect_host_override: None,
        // Production native delivery resolves MX live and dials port 25.
        native_mx: None,
        native_port_override: None,
    };
    run_send_job(&deps, &mut journal, send_job_id, generation)
}

async fn run_credential_probe(state: &crate::CloudMcpState, event: &Value, profile_ref: String) {
    let result = tauri::async_runtime::spawn_blocking(move || {
        let journal = EmailJournal::open_default()?;
        let credentials = super::credentials::CredentialStack::new();
        super::profiles::probe_profile_credentials(&journal, &credentials, &profile_ref)
    })
    .await
    .map_err(|error| format!("credential probe join failed: {error}"));
    match result {
        Ok(Ok(report)) => {
            let _ = crate::cloud_mcp_send_remote_command_status_event(
                state,
                event,
                "completed",
                "Email credential probe completed.",
                Some(&report),
            )
            .await;
        }
        Ok(Err(error)) | Err(error) => {
            let _ = crate::cloud_mcp_send_remote_command_status_event(
                state,
                event,
                "failed",
                "Email credential probe failed.",
                Some(&json!({ "error": error })),
            )
            .await;
        }
    }
}

/// Previous qualification decides failed-vs-degraded (§10.2). This is
/// durable HISTORY, deliberately independent of the 24h eligibility expiry:
/// a device that qualified once and regresses later — even after the window
/// lapsed — reads `degraded`, never `failed`/`pending` (review R2-6).
pub(crate) fn preflight_previously_qualified(
    journal: &EmailJournal,
    profile_ref: &str,
    domain: &str,
) -> bool {
    journal
        .connection()
        .query_row(
            "SELECT COUNT(1) FROM email_native_preflight_runs
             WHERE profile_ref = ?1 AND domain = ?2 AND result = 'qualified'",
            rusqlite::params![profile_ref, domain],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count > 0)
        .unwrap_or(false)
}

async fn run_preflight_snapshot(
    state: &crate::CloudMcpState,
    profile_ref: String,
    domain: String,
    requested_checks: Vec<String>,
    device_id: String,
) {
    use super::preflight::PreflightRun;
    let result = tauri::async_runtime::spawn_blocking(move || {
        let journal = EmailJournal::open_default()?;
        let credentials = super::credentials::CredentialStack::new();
        let previous_qualified = preflight_previously_qualified(&journal, &profile_ref, &domain);
        let observations = super::preflight::collect_observations(
            &journal,
            &credentials,
            &profile_ref,
            &domain,
            &requested_checks,
        );
        let run = PreflightRun::build(
            &device_id,
            &profile_ref,
            &domain,
            &observations,
            previous_qualified,
        );
        // Persist the run + checks (§10.1 tables).
        journal
            .connection()
            .execute(
                "INSERT OR REPLACE INTO email_native_preflight_runs
                 (preflight_id, profile_ref, domain, ran_at_ms, expires_at_ms, result,
                  qualified, eligible, result_sha256, result_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8, ?9)",
                rusqlite::params![
                    run.preflight_id,
                    run.profile_ref,
                    run.domain,
                    run.ran_at_ms,
                    run.expires_at_ms,
                    run.result,
                    (run.result == "qualified") as i64,
                    run.to_wire()["result_sha256"].as_str().unwrap_or_default(),
                    run.to_wire().to_string(),
                ],
            )
            .map_err(|error| format!("preflight run store failed: {error}"))?;
        for check in &run.checks {
            journal
                .connection()
                .execute(
                    "INSERT OR REPLACE INTO email_native_preflight_checks
                     (preflight_id, check_id, status, required, observed, expected, remediation)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    rusqlite::params![
                        run.preflight_id,
                        check.check_id,
                        check.status.as_str(),
                        check.required as i64,
                        check.observed,
                        check.expected,
                        check.remediation,
                    ],
                )
                .map_err(|error| format!("preflight check store failed: {error}"))?;
        }
        Ok::<Value, String>(run.to_wire())
    })
    .await
    .map_err(|error| format!("preflight join failed: {error}"));
    match result {
        Ok(Ok(wire)) => {
            // §10.2: the run is reported through the CONTRACT mutation, not
            // a generic command status — the report is the completion.
            // §8 mutation shape: `email_native_preflight_report {result: PreflightResult}`.
            let payload = json!({
                "contract": contract::EMAIL_CONTRACT,
                "schema_version": contract::EMAIL_SCHEMA_VERSION,
                "result": wire,
                "client_request_id": uuid::Uuid::now_v7().to_string(),
            });
            if let Err(error) = crate::cloud_mcp_ws_request_with_timeout(
                state,
                "email_native_preflight_report",
                &payload,
                std::time::Duration::from_secs(20),
            )
            .await
            {
                crate::log_cloud_sync_event(
                    "email.preflight_report_error",
                    json!({ "error": error }),
                );
            }
        }
        Ok(Err(error)) | Err(error) => {
            crate::log_terminal_status_event(
                "backend.email.preflight_run_failed",
                json!({ "error": error }),
            );
        }
    }
}

/// Strictly parse a §9.3 settlement ack against the event we sent. FAIL
/// CLOSED: the ack must name OUR `status_event_id`, carry a Boolean
/// `applied`, and any `audit` slug must come from the closed registry.
/// Anything else is an error and must NOT mark the event acked (the outbox
/// retries; compaction stays gated).
pub fn parse_send_event_ack(
    sent_status_event_id: &str,
    response: &Value,
) -> Result<(bool, Option<String>), String> {
    // The ack may ride the response root or a nested `data` object; the
    // exact-typed §9.3 parser (contract + schema_version + matching
    // status_event_id + Boolean applied + closed audit) does the rest.
    let ack = response
        .get("data")
        .filter(|data| data.get("applied").is_some() || data.get("status_event_id").is_some())
        .unwrap_or(response);
    let parsed = contract::parse_settlement_ack(ack, sent_status_event_id)?;
    Ok((parsed.applied, parsed.audit))
}

/// Testable core of the §9.3 ack settlement: parse the ack EXACTLY against
/// the event the payload names, then persist it on the given journal. Any
/// Err means the ack was NOT recorded — the caller must keep the durable
/// outbox row alive so the send retries and a well-formed ack can land.
pub fn email_apply_send_event_cloud_ack(
    journal: &mut EmailJournal,
    payload: &Value,
    response: &Value,
) -> Result<(), String> {
    let status_event_id = payload
        .get("status_event_id")
        .and_then(Value::as_str)
        .ok_or_else(|| "send event outbox payload missing status_event_id".to_string())?;
    let (applied, audit) = parse_send_event_ack(status_event_id, response)?;
    journal.record_cloud_ack(status_event_id, applied, audit.as_deref())
}

/// Record a §9.3 settlement ack routed back from the durable outbox
/// (`cloud_mcp_outbox_mark_acked` email_send_event arm). Sync — called from
/// the outbox drain's blocking context. Err ⇒ the outbox row must NOT be
/// deleted (review R2-1): the journal event stays unacked, so the durable
/// retry has to stay alive until a valid ack is both parsed AND persisted.
pub fn email_record_send_event_cloud_ack(payload: &Value, response: &Value) -> Result<(), String> {
    let result = (|| {
        let mut journal = EmailJournal::open_default()?;
        email_apply_send_event_cloud_ack(&mut journal, payload, response)
    })();
    if let Err(error) = result.as_ref() {
        crate::log_terminal_status_event(
            "backend.email.send_event_ack_record_failed",
            json!({
                "status_event_id": payload.get("status_event_id"),
                "error": error,
            }),
        );
    }
    result
}

/// Startup journal recovery (plan §4.3: "journal recovery before cloud
/// connect"): classify crashed jobs per the §6 device matrix. SYNCHRONOUS
/// BY DESIGN — the caller must run this to completion BEFORE the remote
/// command listener or the cloud connection starts, so a wake command can
/// never race recovery into re-running a `data_started` generation. The
/// work is local SQLite only (bounded, no network); settled events land in
/// the journal pending queue and the resume flow hands them to the outbox
/// once the account context exists.
pub fn email_startup_journal_recovery() {
    let device_id = crate::cloud_mcp_email_device_id();
    let result = (|| {
        let mut journal = EmailJournal::open_default()?;
        journal.recover_after_restart(&device_id)
    })();
    match result {
        Ok(settled) if !settled.is_empty() => {
            crate::log_terminal_status_event(
                "backend.email.startup_recovery_settled",
                json!({
                    "settled": settled
                        .iter()
                        .map(|(job, generation, outcome)| {
                            json!({
                                "send_job_id": job,
                                "generation": generation,
                                "outcome": outcome,
                            })
                        })
                        .collect::<Vec<_>>(),
                }),
            );
        }
        Ok(_) => {}
        Err(error) => {
            crate::log_terminal_status_event(
                "backend.email.startup_recovery_failed",
                json!({ "error": error }),
            );
        }
    }
}

/// Post-(re)connect resume flow: re-hand pending §9.2 events to the durable
/// outbox, sync sender capabilities (bindings cache refresh), and run
/// `email_send_resume` — applying reoffers through the SAME
/// journal-before-ack intake path (§9.4) and marking stale generations
/// superseded.
pub async fn email_account_sync_resume_hook(state: &crate::CloudMcpState) {
    use super::cloud_transport::EmailCloudTransport;

    // (a) Pending events → outbox. The whole walk runs on a blocking thread:
    // WsCloudTransport::emit_send_event parks on the runtime internally and
    // must never be called from an async worker thread.
    {
        let emit_state = state.clone();
        let _ = tauri::async_runtime::spawn_blocking(move || {
            let mut journal = EmailJournal::open_default()?;
            let pending = journal.pending_events()?;
            if pending.is_empty() {
                return Ok::<(), String>(());
            }
            let transport = super::cloud_transport::WsCloudTransport { state: emit_state };
            for event in pending {
                if transport.emit_send_event(&event.payload).is_ok() {
                    journal.mark_event_handed_off(&event.status_event_id)?;
                }
            }
            Ok(())
        })
        .await;
    }

    // (b) Capabilities sync → bindings cache.
    let capabilities_payload = tauri::async_runtime::spawn_blocking(|| {
        let journal = EmailJournal::open_default()?;
        let credentials = super::credentials::CredentialStack::new();
        let profiles = super::profiles::list_profiles(&journal)?;
        Ok::<Value, String>(json!({
            "contract": contract::EMAIL_CONTRACT,
            "schema_version": contract::EMAIL_SCHEMA_VERSION,
            "capability_version": contract::EMAIL_CAPABILITY_VERSION,
            "modes": super::capability::supported_modes(),
            "profiles": profiles
                .iter()
                .map(super::profiles::SenderProfile::capability_entry)
                .collect::<Vec<_>>(),
            "runtime": super::capability::runtime_kind(),
            "credential_store": credentials.health().as_str(),
            "client_request_id": uuid::Uuid::now_v7().to_string(),
        }))
    })
    .await
    .unwrap_or_else(|error| Err(format!("capabilities payload join failed: {error}")));
    if let Ok(payload) = capabilities_payload {
        match crate::cloud_mcp_ws_request_with_timeout(
            state,
            "email_sender_capabilities_sync",
            &payload,
            std::time::Duration::from_secs(12),
        )
        .await
        {
            Ok(response) => {
                if let Some(bindings) = response
                    .get("data")
                    .and_then(|data| data.get("result"))
                    .and_then(|result| result.get("bindings"))
                    .cloned()
                {
                    let _ = tauri::async_runtime::spawn_blocking(move || {
                        let mut journal = EmailJournal::open_default()?;
                        super::profiles::store_bindings_cache(&mut journal, &bindings)
                    })
                    .await;
                }
            }
            Err(error) => {
                crate::log_cloud_sync_event(
                    "email.capabilities_sync_error",
                    json!({ "error": error }),
                );
            }
        }
    }

    // (c) email_send_resume with journal summaries.
    let summaries = tauri::async_runtime::spawn_blocking(|| {
        let journal = EmailJournal::open_default()?;
        journal.resume_summaries()
    })
    .await
    .unwrap_or_else(|error| Err(format!("resume summaries join failed: {error}")));
    let Ok(summaries) = summaries else { return };
    let resume_payload = json!({
        "contract": contract::EMAIL_CONTRACT,
        "schema_version": contract::EMAIL_SCHEMA_VERSION,
        "capability_version": contract::EMAIL_CAPABILITY_VERSION,
        "journal_summaries": summaries,
    });
    match crate::cloud_mcp_ws_request_with_timeout(
        state,
        "email_send_resume",
        &resume_payload,
        std::time::Duration::from_secs(12),
    )
    .await
    {
        Ok(response) => {
            let data = response.get("data").cloned().unwrap_or_default();
            // Stale generations → superseded flag (kept non-destructive; the
            // tombstone/compaction path still owns deletion).
            if let Some(stale) = data.get("stale").and_then(Value::as_array).cloned() {
                let _ = tauri::async_runtime::spawn_blocking(move || {
                    let journal = EmailJournal::open_default()?;
                    for entry in stale {
                        let Some(send_job_id) = entry.get("send_job_id").and_then(Value::as_str)
                        else {
                            continue;
                        };
                        // Uniform checked conversion (reviews R2-10/R4-4):
                        // zero/out-of-range values are dropped, never
                        // aliased onto another generation.
                        let Some(generation) = entry
                            .get("generation")
                            .and_then(Value::as_u64)
                            .and_then(|raw| checked_generation(raw).ok())
                        else {
                            continue;
                        };
                        let _ = journal.connection().execute(
                            "UPDATE email_send_jobs SET superseded = 1
                             WHERE send_job_id = ?1 AND generation = ?2
                               AND terminal_outcome IS NULL",
                            rusqlite::params![send_job_id, generation],
                        );
                    }
                    Ok::<(), String>(())
                })
                .await;
            }
            // Reoffers replay through the SAME journal-before-ack intake.
            if let Some(reoffers) = data.get("reoffers").and_then(Value::as_array) {
                for reoffer in reoffers.iter().filter(|value| value.is_object()) {
                    let _ = email_try_handle_remote_command(
                        state,
                        reoffer,
                        "account_sync_resume_replay",
                    )
                    .await;
                }
            }
        }
        Err(error) => {
            crate::log_cloud_sync_event("email.send_resume_error", json!({ "error": error }));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::email::contract::EMAIL_COMMAND_SEND;

    fn temp_journal() -> EmailJournal {
        let dir = std::env::temp_dir().join(format!(
            "diffforge-email-remote-test-{}-{}",
            std::process::id(),
            uuid::Uuid::now_v7()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        EmailJournal::open_at(&dir.join("journal.sqlite")).unwrap()
    }

    fn send_command() -> EmailCommand {
        parse_email_command(
            EMAIL_COMMAND_SEND,
            &json!({
                "command_id": "email-send:job-1:1",
                "send_job_id": "job-1",
                "generation": 1,
                "binding_id": "bind-1",
                "target_device_id": "device-1",
            }),
        )
        .unwrap()
    }

    #[test]
    fn journal_before_ack_accepts_then_dedupes() {
        let mut journal = temp_journal();
        let command = send_command();
        let ack =
            journal_command_before_ack(&mut journal, &command, "live", "device-test").unwrap();
        assert_eq!(ack.result, "accepted");
        assert!(ack.first_status_event_id.is_some());
        assert!(ack.should_execute());
        // The job row exists BEFORE we would have acked (write already
        // committed inside journal_command_before_ack).
        assert!(journal.load_job("job-1", 1).unwrap().is_some());

        // Redelivery of the identical command dedupes to `duplicate` and
        // replays the same first_status_event_id.
        let replay =
            journal_command_before_ack(&mut journal, &command, "replay", "device-test").unwrap();
        assert_eq!(replay.result, "duplicate");
        assert_eq!(replay.first_status_event_id, ack.first_status_event_id);
        assert!(!replay.should_execute());
    }

    #[test]
    fn tampered_payload_is_security_rejected() {
        let mut journal = temp_journal();
        let command = send_command();
        journal_command_before_ack(&mut journal, &command, "live", "device-test").unwrap();
        // Same command_id, different binding => different payload hash.
        let tampered = parse_email_command(
            EMAIL_COMMAND_SEND,
            &json!({
                "command_id": "email-send:job-1:1",
                "send_job_id": "job-1",
                "generation": 1,
                "binding_id": "bind-EVIL",
                "target_device_id": "device-1",
            }),
        )
        .unwrap();
        let ack =
            journal_command_before_ack(&mut journal, &tampered, "live", "device-test").unwrap();
        assert_eq!(ack.result, "rejected");
        assert!(ack.security_rejected);
    }

    #[test]
    fn higher_generation_fences_lower() {
        let mut journal = temp_journal();
        // Generation 2 arrives first.
        let gen2 = parse_email_command(
            EMAIL_COMMAND_SEND,
            &json!({
                "command_id": "email-send:job-1:2",
                "send_job_id": "job-1",
                "generation": 2,
                "binding_id": "bind-1",
                "target_device_id": "device-1",
            }),
        )
        .unwrap();
        journal_command_before_ack(&mut journal, &gen2, "live", "device-test").unwrap();
        // A late generation-1 command is rejected (fenced), not executed.
        let ack = journal_command_before_ack(&mut journal, &send_command(), "live", "device-test")
            .unwrap();
        assert_eq!(ack.result, "rejected");
        assert!(!ack.security_rejected);
        assert!(!ack.should_execute());
    }

    #[test]
    fn generation_retired_ack_parses_strictly() {
        let event = json!({
            "contract": crate::email::contract::EMAIL_CONTRACT,
            "schema_version": 1,
            "kind": "email_generation_retired",
            "send_job_id": "job-1",
            "generation": 1,
            "retired_at_ms": 1,
        });
        assert_eq!(
            parse_generation_retired(&event).unwrap(),
            ("job-1".to_string(), 1)
        );
        // Not the retirement kind at all.
        assert!(parse_generation_retired(&json!({"kind": "other"})).is_err());
        assert!(!is_generation_retired_event(&json!({"kind": "other"})));
        // Envelope-less retirement events fail closed (review #10).
        let mut missing_envelope = event.clone();
        missing_envelope.as_object_mut().unwrap().remove("contract");
        assert!(parse_generation_retired(&missing_envelope).is_err());
        assert!(is_generation_retired_event(&missing_envelope));
        // A u32-overflowing generation is an ERROR, never an alias.
        let mut overflow = event.clone();
        overflow["generation"] = json!(4_294_967_297u64);
        assert!(parse_generation_retired(&overflow).is_err());
        // §0.2 decimal-string generations are accepted with checked range.
        let mut stringy = event.clone();
        stringy["generation"] = json!("2");
        assert_eq!(
            parse_generation_retired(&stringy).unwrap(),
            ("job-1".to_string(), 2)
        );
    }

    #[test]
    fn ack_payload_carries_first_status_event_id() {
        let command = send_command();
        let ack = IntakeAck::accepted("evt-1".to_string());
        let payload = email_intake_ack_payload(&command, &ack, "device-1", "device-1");
        assert_eq!(payload["status"], "accepted");
        assert_eq!(payload["first_status_event_id"], "evt-1");
        assert_eq!(payload["command_kind"], "email_send");
    }
}

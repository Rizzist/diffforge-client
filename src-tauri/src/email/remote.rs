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

/// Journal a wake/companion command and return the ack. This is the single
/// entry both intake paths call — the journal write commits inside here,
/// strictly BEFORE the returned ack is emitted by the caller.
pub fn journal_command_before_ack(
    journal: &mut EmailJournal,
    command: &EmailCommand,
    source: &str,
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

/// The durable `remote_command_ack` payload (§9.4). Enqueued to the outbox
/// AFTER the journal write, carrying the ack result + first_status_event_id.
pub fn email_intake_ack_payload(
    command: &EmailCommand,
    ack: &IntakeAck,
    device_id: &str,
    target_device_id: &str,
) -> Value {
    let mut payload = json!({
        "contract": contract::EMAIL_CONTRACT,
        "schema_version": contract::EMAIL_SCHEMA_VERSION,
        "event_kind": "remote_command_ack",
        "command_id": command.command_id(),
        "command_kind": command.kind(),
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

/// Detect the cloud→device `email_generation_retired` ack (§9.4). Returns
/// (send_job_id, generation) when the event is that kind.
pub fn parse_generation_retired(event: &Value) -> Option<(String, u32)> {
    let kind = event
        .get("kind")
        .or_else(|| event.get("event_kind"))
        .and_then(Value::as_str)?;
    if kind != EMAIL_GENERATION_RETIRED_KIND {
        return None;
    }
    let send_job_id = event.get("send_job_id").and_then(Value::as_str)?.to_string();
    let generation = event.get("generation").and_then(Value::as_u64)? as u32;
    Some((send_job_id, generation))
}

/// Extract the command kind from a remote-command event (root or nested).
pub fn event_email_command(event: &Value) -> Option<EmailCommand> {
    let kind = event
        .get("command_kind")
        .or_else(|| event.get("payload").and_then(|inner| inner.get("command_kind")))
        .and_then(Value::as_str)?;
    if !is_email_command_kind(kind) {
        return None;
    }
    parse_email_command(kind, event).ok()
}

/// True when this event is an email wake/companion command — used by the
/// dispatcher's rust-owned matcher so the generic UI-emit path is skipped.
pub fn is_email_command_event(event: &Value) -> bool {
    event
        .get("command_kind")
        .or_else(|| event.get("payload").and_then(|inner| inner.get("command_kind")))
        .and_then(Value::as_str)
        .is_some_and(is_email_command_kind)
}

// ---------------------------------------------------------------------
// Runtime glue (cloud_mcp integration). These functions are the ONLY email
// entry points cloud_mcp.rs calls; they run the journal writes on blocking
// threads and never ack before the journal commit returns.
// ---------------------------------------------------------------------

/// Handle an email wake/companion command from EITHER intake path
/// (`live_intake` or `account_sync_resume_replay`). Returns true when the
/// event was an email command (handled here; the generic pipeline must skip
/// it — including its generic "received" ack).
pub async fn email_try_handle_remote_command(
    state: &crate::CloudMcpState,
    event: &Value,
    source: &'static str,
) -> bool {
    let Some(command) = event_email_command(event) else {
        return false;
    };
    let device_id = crate::cloud_mcp_email_device_id();

    // 1) Journal BEFORE ack (§9.4). A journal failure means NO ack of
    // acceptance — report failure so the cloud re-offers later.
    let journal_command = command.clone();
    let intake = tauri::async_runtime::spawn_blocking(move || {
        let mut journal = EmailJournal::open_default()?;
        journal_command_before_ack(&mut journal, &journal_command, source)
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
            let _ = crate::cloud_mcp_send_remote_command_status_event(
                state,
                event,
                "failed",
                "Email command could not be journaled; not acknowledged.",
                Some(&json!({ "reason": "journal_write_failed" })),
            )
            .await;
            return true;
        }
    };

    // 2) Ack (rides the durable outbox via the status-event helper).
    let details = json!({
        "ack": ack.result,
        "first_status_event_id": ack.first_status_event_id,
        "security_rejected": ack.security_rejected,
        "intake_source": source,
    });
    let message = match ack.result.as_str() {
        "accepted" => "Email command journaled and accepted.",
        "duplicate" => "Email command already journaled (duplicate).",
        _ => {
            if ack.security_rejected {
                "Email command rejected: payload hash mismatch for command id."
            } else {
                "Email command rejected: fenced by a higher generation."
            }
        }
    };
    let _ = crate::cloud_mcp_send_remote_command_status_event(
        state,
        event,
        &ack.result,
        message,
        Some(&details),
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
    // credential_required recovery, §6b.1).
    match &command {
        EmailCommand::Send {
            send_job_id,
            generation,
            ..
        } => {
            if ack.should_execute() || ack.result == "duplicate" {
                spawn_send_worker(
                    state.clone(),
                    send_job_id.clone(),
                    *generation,
                    device_id,
                    ack.first_status_event_id.clone().filter(|_| ack.should_execute()),
                );
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
            ..
        } => {
            if ack.should_execute() {
                run_preflight_snapshot(state, event, profile_ref.clone(), domain.clone(), device_id)
                    .await;
            }
        }
    }
    true
}

/// Handle cloud→device email ws events that are NOT remote commands — today
/// the §9.4 `email_generation_retired` ack, which unlocks tombstone
/// compaction (§10.1). Returns true when consumed.
pub async fn email_try_handle_ws_event(_event_kind: &str, event: &Value) -> bool {
    let Some((send_job_id, generation)) = parse_generation_retired(event) else {
        return false;
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

/// Spawn the send worker for one (send_job_id, generation) on a blocking
/// thread, panic-caught per the self-restarting worker shape — a panic is
/// logged and the pair is left to the resume path (never silently lost).
pub fn spawn_send_worker(
    state: crate::CloudMcpState,
    send_job_id: String,
    generation: u32,
    device_id: String,
    received_event_id: Option<String>,
) {
    tauri::async_runtime::spawn_blocking(move || {
        let run = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            run_send_worker_once(
                &state,
                &send_job_id,
                generation,
                &device_id,
                received_event_id.as_deref(),
            )
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
    received_event_id: Option<&str>,
) -> Result<super::submission::SubmissionResult, String> {
    use super::cloud_transport::WsCloudTransport;
    use super::credentials::CredentialStack;
    use super::submission::{run_send_job, send_event_payload, SubmissionDeps};

    let mut journal = EmailJournal::open_default()?;
    let transport = WsCloudTransport {
        state: state.clone(),
    };
    // Emit the phase-received event first (its id is the ack's
    // first_status_event_id) — journal row, then outbox handoff.
    if let Some(status_event_id) = received_event_id {
        if let Some(job) = journal.load_job(send_job_id, generation)? {
            let payload = send_event_payload(
                &job,
                device_id,
                super::contract::SendPhase::Received,
                status_event_id,
                None,
                None,
                None,
                None,
            );
            journal.insert_send_event(
                send_job_id,
                generation,
                super::contract::SendPhase::Received,
                status_event_id,
                &payload,
            )?;
            use super::cloud_transport::EmailCloudTransport;
            transport.emit_send_event(&payload)?;
            journal.mark_event_handed_off(status_event_id)?;
        }
    }
    let secrets = CredentialStack::new();
    let deps = SubmissionDeps {
        transport: &transport,
        secrets: &secrets,
        device_id: device_id.to_string(),
        extra_root_cert_pem: None,
        connect_host_override: None,
    };
    run_send_job(&deps, &mut journal, send_job_id, generation)
}

async fn run_credential_probe(
    state: &crate::CloudMcpState,
    event: &Value,
    profile_ref: String,
) {
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

async fn run_preflight_snapshot(
    state: &crate::CloudMcpState,
    event: &Value,
    profile_ref: String,
    domain: String,
    device_id: String,
) {
    use super::preflight::{PreflightObservations, PreflightRun};
    let result = tauri::async_runtime::spawn_blocking(move || {
        let journal = EmailJournal::open_default()?;
        let credentials = super::credentials::CredentialStack::new();
        let journal_ok = journal
            .health_check()
            .ok()
            .and_then(|value| value.get("ok").and_then(Value::as_bool));
        let observations = PreflightObservations {
            journal_healthy: journal_ok,
            credential_store_healthy: Some(matches!(
                credentials.health(),
                super::credentials::CredentialStoreHealth::Healthy
            )),
            always_on: Some(matches!(
                super::capability::runtime_kind(),
                "daemon" | "background"
            )),
            ..PreflightObservations::default()
        };
        let run = PreflightRun::build(&device_id, &profile_ref, &domain, &observations, false);
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
            let _ = crate::cloud_mcp_send_remote_command_status_event(
                state,
                event,
                "completed",
                "Email preflight snapshot recorded.",
                Some(&json!({ "preflight": wire })),
            )
            .await;
        }
        Ok(Err(error)) | Err(error) => {
            let _ = crate::cloud_mcp_send_remote_command_status_event(
                state,
                event,
                "failed",
                "Email preflight run failed.",
                Some(&json!({ "error": error })),
            )
            .await;
        }
    }
}

/// Record a §9.3 settlement ack routed back from the durable outbox
/// (`cloud_mcp_outbox_mark_acked` email_send_event arm). Sync — called from
/// the outbox drain's blocking context.
pub fn email_record_send_event_cloud_ack(payload: &Value, response: &Value) {
    let Some(status_event_id) = payload
        .get("status_event_id")
        .and_then(Value::as_str)
        .map(str::to_string)
    else {
        return;
    };
    // The ack may ride the response root or a nested `data` object.
    let ack = response
        .get("data")
        .filter(|data| data.get("applied").is_some() || data.get("status_event_id").is_some())
        .unwrap_or(response);
    let applied = ack.get("applied").and_then(Value::as_bool).unwrap_or(true);
    let audit = ack
        .get("audit")
        .and_then(Value::as_str)
        .map(str::to_string);
    let result = (|| {
        let mut journal = EmailJournal::open_default()?;
        journal.record_cloud_ack(&status_event_id, applied, audit.as_deref())
    })();
    if let Err(error) = result {
        crate::log_terminal_status_event(
            "backend.email.send_event_ack_record_failed",
            json!({ "status_event_id": status_event_id, "error": error }),
        );
    }
}

/// Startup journal recovery (plan §4.3: "journal recovery before cloud
/// connect"): classify crashed jobs per the §6 device matrix. Settled
/// events land in the journal pending queue; the resume flow hands them to
/// the outbox once the account context exists.
pub fn email_startup_journal_recovery() {
    tauri::async_runtime::spawn_blocking(move || {
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
    });
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
            "modes": ["provider", "native"],
            "profiles": profiles
                .iter()
                .map(super::profiles::SenderProfile::capability_entry)
                .collect::<Vec<_>>(),
            "runtime": super::capability::runtime_kind(),
            "credential_store": credentials.health().as_str(),
            "client_request_id": uuid::Uuid::new_v4().to_string(),
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
                        let Some(generation) = entry.get("generation").and_then(Value::as_u64)
                        else {
                            continue;
                        };
                        let _ = journal.connection().execute(
                            "UPDATE email_send_jobs SET superseded = 1
                             WHERE send_job_id = ?1 AND generation = ?2
                               AND terminal_outcome IS NULL",
                            rusqlite::params![send_job_id, generation as i64],
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
            uuid::Uuid::new_v4()
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
        let ack = journal_command_before_ack(&mut journal, &command, "live").unwrap();
        assert_eq!(ack.result, "accepted");
        assert!(ack.first_status_event_id.is_some());
        assert!(ack.should_execute());
        // The job row exists BEFORE we would have acked (write already
        // committed inside journal_command_before_ack).
        assert!(journal.load_job("job-1", 1).unwrap().is_some());

        // Redelivery of the identical command dedupes to `duplicate` and
        // replays the same first_status_event_id.
        let replay = journal_command_before_ack(&mut journal, &command, "replay").unwrap();
        assert_eq!(replay.result, "duplicate");
        assert_eq!(replay.first_status_event_id, ack.first_status_event_id);
        assert!(!replay.should_execute());
    }

    #[test]
    fn tampered_payload_is_security_rejected() {
        let mut journal = temp_journal();
        let command = send_command();
        journal_command_before_ack(&mut journal, &command, "live").unwrap();
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
        let ack = journal_command_before_ack(&mut journal, &tampered, "live").unwrap();
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
        journal_command_before_ack(&mut journal, &gen2, "live").unwrap();
        // A late generation-1 command is rejected (fenced), not executed.
        let ack = journal_command_before_ack(&mut journal, &send_command(), "live").unwrap();
        assert_eq!(ack.result, "rejected");
        assert!(!ack.security_rejected);
        assert!(!ack.should_execute());
    }

    #[test]
    fn generation_retired_ack_parses() {
        let event = json!({
            "kind": "email_generation_retired",
            "send_job_id": "job-1",
            "generation": 1,
            "retired_at_ms": 1,
        });
        assert_eq!(
            parse_generation_retired(&event),
            Some(("job-1".to_string(), 1))
        );
        assert!(parse_generation_retired(&json!({"kind": "other"})).is_none());
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

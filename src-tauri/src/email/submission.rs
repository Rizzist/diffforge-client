//! The device send state machine (contract §6b.2, plan §4.3): drives one
//! (send_job_id, generation) from `received` through `settled`, journaling
//! every boundary BEFORE it is reported and emitting the §9.2 phase events.
//!
//! Laws enforced here (tests assert each):
//! - phases advance monotonically; journal writes precede event emission;
//! - `data_started` commits (FULL) before DATA; the cancel window closes at
//!   that boundary;
//! - a lease-renewal fence stops the worker before the next SMTP boundary;
//!   after `data_started` the transaction finishes and reports (§6b.3);
//! - ambiguity at/after DATA settles `delivery_unknown` and is NEVER
//!   auto-retried (tombstone dominates);
//! - the provider 2xx and the terminal outcome are journaled before any
//!   report leaves the device;
//! - local credential failures never tombstone the generation — the job is
//!   abandoned non-terminally so the cloud's credential_required →
//!   released → re-offer path can re-execute it.

use std::cell::RefCell;

use serde_json::{json, Map, Value};

use super::cloud_transport::{EmailCloudTransport, PrepareGrant, PrepareOutcome, RenewOutcome};
use super::contract::{self, ResponseClass, SendPhase};
use super::credentials::SecretResolver;
use super::email_killpoint;
use super::journal::{EmailJournal, PendingEventRow, RecipientRow, SendJobRow};
use super::mime::verify_mime;
use super::profiles::{binding_profile_ref, load_profile, SenderProfile};
use super::smtp_session::{
    SmtpCredentials, SmtpFailure, SmtpSecurity, SmtpSession, SmtpTarget,
};

pub const DEFAULT_EHLO: &str = "device.diffforge.local";

pub struct SubmissionDeps<'a> {
    pub transport: &'a dyn EmailCloudTransport,
    pub secrets: &'a dyn SecretResolver,
    pub device_id: String,
    /// Extra TLS trust anchor for the provider session (tests only).
    pub extra_root_cert_pem: Option<String>,
    /// Socket-level connect override (tests dial the sink; None in prod).
    pub connect_host_override: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SubmissionResult {
    /// The job settled; the outcome names the journaled terminal.
    Terminal(String),
    /// Non-terminal stop — the reoffer/resume path retries later.
    Abandoned(String),
    /// The pair cannot run (tombstoned / superseded / already terminal).
    NotRunnable(String),
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

/// Build a §9.2 phase-discriminated event payload. Fields appear exactly at
/// and above their phase; there is no `terminal` bool.
#[allow(clippy::too_many_arguments)]
pub fn send_event_payload(
    job: &SendJobRow,
    device_id: &str,
    phase: SendPhase,
    status_event_id: &str,
    per_recipient: Option<Vec<Value>>,
    job_response: Option<&contract::SanitizedResponse>,
    provider_queue_id: Option<&str>,
    error_class: Option<&str>,
) -> Value {
    let mut map = Map::new();
    map.insert("contract".into(), json!(contract::EMAIL_CONTRACT));
    map.insert("schema_version".into(), json!(contract::EMAIL_SCHEMA_VERSION));
    map.insert("status_event_id".into(), json!(status_event_id));
    map.insert("command_id".into(), json!(job.command_id));
    map.insert("send_job_id".into(), json!(job.send_job_id));
    map.insert("generation".into(), json!(job.generation));
    map.insert("device_id".into(), json!(device_id));
    map.insert("binding_id".into(), json!(job.binding_id));
    map.insert("phase".into(), json!(phase.as_str()));
    map.insert("phase_rank".into(), json!(phase.rank()));
    map.insert("occurred_at_ms".into(), json!(now_ms()));
    if phase.rank() >= SendPhase::Prepared.rank() {
        if let Some(mode) = job.mode.as_deref() {
            map.insert("mode".into(), json!(mode));
        }
        if let Some(lease_id) = job.lease_id.as_deref() {
            map.insert("lease_id".into(), json!(lease_id));
        }
        map.insert(
            "lease_epoch".into(),
            json!(contract::u64_to_wire(job.lease_epoch)),
        );
    }
    if phase.rank() >= SendPhase::Verified.rank() {
        if let Some(mime_sha256) = job.mime_sha256.as_deref() {
            map.insert("mime_sha256".into(), json!(mime_sha256));
        }
        map.insert("data_started".into(), json!(job.data_started));
    }
    if phase == SendPhase::Settled {
        map.insert("data_started".into(), json!(job.data_started));
        map.insert(
            "per_recipient".into(),
            Value::Array(per_recipient.unwrap_or_default()),
        );
        if let Some(response) = job_response {
            map.insert("response".into(), response.to_value());
        }
        if let Some(queue_id) = provider_queue_id {
            map.insert("provider_queue_id".into(), json!(queue_id));
        }
        map.insert("error_class".into(), json!(error_class.unwrap_or("none")));
    }
    Value::Object(map)
}

/// Journal + emit one non-terminal phase event (journal row first, handoff
/// second — the report never precedes the journal).
fn emit_phase_event(
    journal: &mut EmailJournal,
    transport: &dyn EmailCloudTransport,
    job: &SendJobRow,
    device_id: &str,
    phase: SendPhase,
) -> Result<(), String> {
    let status_event_id = uuid::Uuid::new_v4().to_string();
    let payload = send_event_payload(
        job,
        device_id,
        phase,
        &status_event_id,
        None,
        None,
        None,
        None,
    );
    journal.insert_send_event(&job.send_job_id, job.generation, phase, &status_event_id, &payload)?;
    transport.emit_send_event(&payload)?;
    journal.mark_event_handed_off(&status_event_id)?;
    Ok(())
}

/// Journal the terminal outcome (job + tombstone + settled event in one FULL
/// txn), then report it. Terminal-journaled-before-reported by construction.
#[allow(clippy::too_many_arguments)]
fn settle(
    journal: &mut EmailJournal,
    transport: &dyn EmailCloudTransport,
    job: &SendJobRow,
    device_id: &str,
    outcome: &str,
    per_recipient: Vec<Value>,
    job_response: Option<&contract::SanitizedResponse>,
    provider_queue_id: Option<&str>,
    error_class: &str,
) -> Result<SubmissionResult, String> {
    let status_event_id = uuid::Uuid::new_v4().to_string();
    // The settled payload reflects the post-settlement job state.
    let mut settled_job = job.clone();
    settled_job.phase = SendPhase::Settled.as_str().to_string();
    settled_job.phase_rank = SendPhase::Settled.rank();
    let payload = send_event_payload(
        &settled_job,
        device_id,
        SendPhase::Settled,
        &status_event_id,
        Some(per_recipient),
        job_response,
        provider_queue_id,
        Some(error_class),
    );
    let event = PendingEventRow {
        status_event_id: status_event_id.clone(),
        send_job_id: job.send_job_id.clone(),
        generation: job.generation,
        payload: payload.clone(),
    };
    journal.journal_terminal(&job.send_job_id, job.generation, outcome, &event)?;
    email_killpoint("post_journal_pre_report");
    transport.emit_send_event(&payload)?;
    journal.mark_event_handed_off(&status_event_id)?;
    Ok(SubmissionResult::Terminal(outcome.to_string()))
}

fn recipient_state_value(recipient: &RecipientRow) -> Value {
    let mut entry = json!({
        "recipient_ref": recipient.recipient_ref,
        "role": recipient.role,
        "address": recipient.address,
        "delivery_state": recipient.status,
        "updated_at_ms": now_ms(),
    });
    if let Some(class) = recipient.response_class.as_deref() {
        let mut response = Map::new();
        if let Some(code) = recipient.smtp_code {
            if !ResponseClass::parse(class)
                .map(|parsed| parsed.has_no_server_code())
                .unwrap_or(true)
            {
                response.insert("smtp_code".into(), json!(code));
            }
        }
        if let Some(enhanced) = recipient.enhanced_code.as_deref() {
            response.insert("enhanced_code".into(), json!(enhanced));
        }
        response.insert("response_class".into(), json!(class));
        entry["response"] = Value::Object(response);
    }
    if let Some(retry_at_ms) = recipient.retry_at_ms {
        entry["retry_at_ms"] = json!(retry_at_ms);
    }
    entry
}

fn provider_queue_id_of(message: &str) -> Option<String> {
    let lower = message.to_ascii_lowercase();
    let marker = lower.find("queued as ")?;
    message[marker + "queued as ".len()..]
        .split_whitespace()
        .next()
        .map(str::to_string)
}

/// Entry point: run one (send_job_id, generation) to a stop point.
pub fn run_send_job(
    deps: &SubmissionDeps<'_>,
    journal: &mut EmailJournal,
    send_job_id: &str,
    generation: u32,
) -> Result<SubmissionResult, String> {
    let Some(job) = journal.load_job(send_job_id, generation)? else {
        return Ok(SubmissionResult::NotRunnable("unknown_job".to_string()));
    };
    if let Some(outcome) = job.terminal_outcome.as_deref() {
        return Ok(SubmissionResult::NotRunnable(format!(
            "already_terminal:{outcome}"
        )));
    }
    if journal.tombstone(send_job_id, generation)?.is_some() {
        return Ok(SubmissionResult::NotRunnable("tombstoned".to_string()));
    }
    if job.superseded {
        return Ok(SubmissionResult::NotRunnable("superseded".to_string()));
    }
    if job.cancel_requested {
        let recipients = journal.load_recipients(send_job_id, generation)?;
        let per_recipient = recipients.iter().map(recipient_state_value).collect();
        return settle(
            journal,
            deps.transport,
            &job,
            &deps.device_id,
            "cancelled",
            per_recipient,
            None,
            None,
            "cancelled",
        );
    }

    // ---- prepare (lease) ----
    let outcome = deps.transport.prepare(
        send_job_id,
        generation,
        &job.command_id,
        &job.binding_id,
        job.lease_epoch,
    )?;
    let grant = match outcome {
        PrepareOutcome::Refused { slug } => {
            return match slug.as_str() {
                "cancelled" => settle(
                    journal,
                    deps.transport,
                    &job,
                    &deps.device_id,
                    "cancelled",
                    vec![],
                    None,
                    None,
                    "cancelled",
                ),
                "superseded" | "already_terminal" => {
                    // The cloud has moved past this generation; journal the
                    // terminal locally so the tombstone dominates redelivery.
                    settle(
                        journal,
                        deps.transport,
                        &job,
                        &deps.device_id,
                        "cancelled",
                        vec![],
                        None,
                        None,
                        "cancelled",
                    )
                }
                // credential_required / not_ready / anything else state-shaped:
                // stop non-terminally; the cloud re-offers when ready.
                other => Ok(SubmissionResult::Abandoned(other.to_string())),
            };
        }
        PrepareOutcome::Leased(grant) => grant,
    };

    run_leased_send(deps, journal, job, *grant)
}

fn run_leased_send(
    deps: &SubmissionDeps<'_>,
    journal: &mut EmailJournal,
    job: SendJobRow,
    grant: PrepareGrant,
) -> Result<SubmissionResult, String> {
    let send_job_id = job.send_job_id.clone();
    let generation = job.generation;

    journal.record_lease(
        &send_job_id,
        generation,
        &grant.mode,
        &grant.lease_id,
        grant.lease_epoch,
        grant.expires_at_ms,
        &grant.mime_sha256,
        grant.mime_size_bytes as i64,
    )?;
    journal.advance_phase(&send_job_id, generation, SendPhase::Prepared)?;
    let mut job = journal
        .load_job(&send_job_id, generation)?
        .ok_or_else(|| "job vanished mid-run".to_string())?;
    emit_phase_event(journal, deps.transport, &job, &deps.device_id, SendPhase::Prepared)?;
    email_killpoint("post_lease_journaled");

    journal.advance_phase(&send_job_id, generation, SendPhase::LeaseHeld)?;
    job.phase = SendPhase::LeaseHeld.as_str().to_string();
    job.phase_rank = SendPhase::LeaseHeld.rank();
    emit_phase_event(journal, deps.transport, &job, &deps.device_id, SendPhase::LeaseHeld)?;

    // ---- download ----
    journal.advance_phase(&send_job_id, generation, SendPhase::Downloading)?;
    job.phase = SendPhase::Downloading.as_str().to_string();
    job.phase_rank = SendPhase::Downloading.rank();
    emit_phase_event(journal, deps.transport, &job, &deps.device_id, SendPhase::Downloading)?;
    let mime_bytes = match deps
        .transport
        .download_mime(&grant.mime_path, &grant.mime_transfer_id)
    {
        Ok(bytes) => bytes,
        Err(error) => return Ok(SubmissionResult::Abandoned(format!("download_failed:{error}"))),
    };
    email_killpoint("post_download");

    // ---- verify (mime.rs law: verify before any send) ----
    if let Err(error) = verify_mime(
        &mime_bytes,
        &grant.mime_sha256,
        grant.mime_size_bytes,
        &grant.identity_address,
        &grant.envelope,
    ) {
        // A verification failure is a hard integrity stop for this
        // generation — never send unverified bytes.
        let job = journal
            .load_job(&send_job_id, generation)?
            .ok_or_else(|| "job vanished mid-run".to_string())?;
        let result = settle(
            journal,
            deps.transport,
            &job,
            &deps.device_id,
            "failed",
            vec![],
            None,
            None,
            "protocol",
        )?;
        crate::log_terminal_status_event(
            "backend.email.mime_verify_failed",
            json!({
                "send_job_id": send_job_id,
                "generation": generation,
                "error": error,
            }),
        );
        return Ok(result);
    }
    journal.advance_phase(&send_job_id, generation, SendPhase::Verified)?;
    let job = journal
        .load_job(&send_job_id, generation)?
        .ok_or_else(|| "job vanished mid-run".to_string())?;
    emit_phase_event(journal, deps.transport, &job, &deps.device_id, SendPhase::Verified)?;
    email_killpoint("post_verified");

    // Journal envelope recipients (pending).
    let recipients: Vec<RecipientRow> = grant
        .envelope
        .recipients
        .iter()
        .map(|recipient| RecipientRow {
            recipient_ref: recipient.recipient_ref.clone(),
            role: recipient.role.clone(),
            address: recipient.address.clone(),
            domain: recipient.domain.clone(),
            status: "pending".to_string(),
            smtp_code: None,
            enhanced_code: None,
            response_class: None,
            response_sanitized: None,
            retry_at_ms: None,
        })
        .collect();
    journal.replace_recipients(&send_job_id, generation, &recipients)?;

    if grant.mode == "native" {
        return Ok(SubmissionResult::Abandoned(
            "native_mode_requires_native_delivery_worker".to_string(),
        ));
    }
    run_provider_transaction(deps, journal, job, &grant, &mime_bytes)
}

fn run_provider_transaction(
    deps: &SubmissionDeps<'_>,
    journal: &mut EmailJournal,
    job: SendJobRow,
    grant: &PrepareGrant,
    mime_bytes: &[u8],
) -> Result<SubmissionResult, String> {
    let send_job_id = job.send_job_id.clone();
    let generation = job.generation;

    // ---- resolve profile + credentials (device-local) ----
    let Some(profile_ref) = binding_profile_ref(journal, &job.binding_id)? else {
        return Ok(SubmissionResult::Abandoned("binding_unmapped".to_string()));
    };
    let Some(profile) = load_profile(journal, &profile_ref)? else {
        return Ok(SubmissionResult::Abandoned("profile_missing".to_string()));
    };
    let credentials = provider_credentials(&profile, deps.secrets)?;
    let Some(smtp_host) = profile.smtp_host.clone() else {
        return Ok(SubmissionResult::Abandoned("profile_incomplete".to_string()));
    };
    let port = profile.smtp_port.unwrap_or(587);
    let security = match profile.smtp_security.as_deref() {
        Some(super::profiles::SMTP_SECURITY_IMPLICIT) => SmtpSecurity::ImplicitTls,
        Some(super::profiles::SMTP_SECURITY_STARTTLS) => SmtpSecurity::StartTls,
        None if port == 465 => SmtpSecurity::ImplicitTls,
        _ => SmtpSecurity::StartTls,
    };

    // ---- renew the lease before entering SMTP (fence check) ----
    match deps.transport.lease_renew(
        &send_job_id,
        generation,
        &grant.lease_id,
        grant.lease_epoch,
        &grant.fence_token,
        SendPhase::Connecting.as_str(),
    ) {
        Ok(RenewOutcome::Extended { expires_at_ms }) => {
            journal.extend_lease(&send_job_id, generation, grant.lease_epoch, expires_at_ms)?;
        }
        Ok(RenewOutcome::Refused { slug, .. }) => {
            return match slug.as_str() {
                "cancelled" => {
                    let job = journal
                        .load_job(&send_job_id, generation)?
                        .ok_or_else(|| "job vanished mid-run".to_string())?;
                    settle(
                        journal,
                        deps.transport,
                        &job,
                        &deps.device_id,
                        "cancelled",
                        vec![],
                        None,
                        None,
                        "cancelled",
                    )
                }
                // fenced / superseded: stop before the next SMTP boundary.
                other => Ok(SubmissionResult::Abandoned(format!("lease_{other}"))),
            };
        }
        Err(error) => return Ok(SubmissionResult::Abandoned(format!("renew_failed:{error}"))),
    }

    let attempt = journal.begin_attempt(&send_job_id, generation, Some(&smtp_host))?;
    journal.advance_phase(&send_job_id, generation, SendPhase::Connecting)?;
    let job = journal
        .load_job(&send_job_id, generation)?
        .ok_or_else(|| "job vanished mid-run".to_string())?;
    emit_phase_event(journal, deps.transport, &job, &deps.device_id, SendPhase::Connecting)?;
    email_killpoint("pre_connect");

    let target = SmtpTarget {
        host: smtp_host.clone(),
        port,
        connect_host: deps.connect_host_override.clone(),
        security,
        ehlo: DEFAULT_EHLO.to_string(),
        extra_root_cert_pem: deps.extra_root_cert_pem.clone(),
        timeout: std::time::Duration::from_secs(30),
    };
    let mut session = match SmtpSession::connect(&target) {
        Ok(session) => session,
        Err(failure) => {
            journal.finish_attempt(
                &send_job_id,
                generation,
                attempt,
                SendPhase::Connecting.as_str(),
                failure.response_class.as_str(),
            )?;
            return Ok(SubmissionResult::Abandoned(format!(
                "connect_failed:{}",
                failure.response_class.as_str()
            )));
        }
    };

    if let Some(credentials) = credentials.as_ref() {
        if let Err(failure) = session.authenticate(credentials) {
            journal.finish_attempt(
                &send_job_id,
                generation,
                attempt,
                SendPhase::Connecting.as_str(),
                if failure.is_credential_failure() {
                    "credential_failure"
                } else {
                    failure.response_class.as_str()
                },
            )?;
            // Credential failures never tombstone the generation — the
            // cloud's credential_required path re-offers it (§6b.1).
            return Ok(SubmissionResult::Abandoned(
                if failure.is_credential_failure() {
                    "credential_failure".to_string()
                } else {
                    format!("auth_failed:{}", failure.response_class.as_str())
                },
            ));
        }
    }
    email_killpoint("post_auth");

    let all_recipients: Vec<String> = grant
        .envelope
        .recipients
        .iter()
        .map(|recipient| recipient.address.clone())
        .collect();

    // Hooks need the journal mutably while we also use it between calls;
    // the session calls them strictly sequentially, so a RefCell is sound.
    let journal_cell = RefCell::new(journal);
    let deps_transport = deps.transport;
    let device_id = deps.device_id.clone();
    let transaction = session.send_transaction(
        &grant.envelope.mail_from,
        &all_recipients,
        mime_bytes,
        || {
            let mut guard = journal_cell.borrow_mut();
            let journal: &mut EmailJournal = &mut *guard;
            let _ = journal.advance_phase(&send_job_id, generation, SendPhase::MailFromSent);
            if let Ok(Some(job)) = journal.load_job(&send_job_id, generation) {
                let _ = emit_phase_event(
                    journal,
                    deps_transport,
                    &job,
                    &device_id,
                    SendPhase::MailFromSent,
                );
            }
            email_killpoint("post_mail_from");
        },
        || {
            let mut guard = journal_cell.borrow_mut();
            let journal: &mut EmailJournal = &mut *guard;
            // The cancel window closes here — honored strictly before DATA.
            let job = journal
                .load_job(&send_job_id, generation)
                .map_err(|error| format!("cancel check failed: {error}"))?
                .ok_or_else(|| "job vanished before DATA".to_string())?;
            if job.cancel_requested {
                return Err("cancel_requested".to_string());
            }
            if job.superseded {
                return Err("superseded".to_string());
            }
            // Renew the fence one last time before the DATA boundary.
            match deps_transport.lease_renew(
                &send_job_id,
                generation,
                &grant.lease_id,
                grant.lease_epoch,
                &grant.fence_token,
                SendPhase::MailFromSent.as_str(),
            ) {
                Ok(RenewOutcome::Extended { expires_at_ms }) => {
                    let _ = journal.extend_lease(
                        &send_job_id,
                        generation,
                        grant.lease_epoch,
                        expires_at_ms,
                    );
                }
                Ok(RenewOutcome::Refused { slug, .. }) => {
                    return Err(format!("lease_{slug}"));
                }
                Err(error) => {
                    // A renewal transport failure fences the holder: stop
                    // before the DATA boundary (§6b.3).
                    return Err(format!("renew_failed:{error}"));
                }
            }
            journal
                .mark_data_started(&send_job_id, generation)
                .map_err(|error| format!("data_started journal failed: {error}"))?;
            email_killpoint("post_data_started_journal");
            if let Ok(Some(job)) = journal.load_job(&send_job_id, generation) {
                let _ = emit_phase_event(
                    journal,
                    deps_transport,
                    &job,
                    &device_id,
                    SendPhase::DataStarted,
                );
            }
            Ok(())
        },
    );
    let journal = journal_cell.into_inner();

    match transaction {
        Ok((response, _rcpt_responses)) => {
            let code = super::smtp_session::response_code_u16(&response);
            let message = response.message().collect::<Vec<&str>>().join(" ");
            // 2xx journaled BEFORE reported.
            journal.mark_data_completed(&send_job_id, generation, Some(code), "accepted")?;
            email_killpoint("post_data_completed_journal");
            for recipient in &grant.envelope.recipients {
                journal.update_recipient_status(
                    &send_job_id,
                    generation,
                    &recipient.recipient_ref,
                    "submitted",
                    Some(code),
                    None,
                    Some("accepted"),
                    Some(&message.chars().take(300).collect::<String>()),
                    None,
                )?;
            }
            journal.finish_attempt(
                &send_job_id,
                generation,
                attempt,
                SendPhase::Settled.as_str(),
                "submitted",
            )?;
            let job = journal
                .load_job(&send_job_id, generation)?
                .ok_or_else(|| "job vanished post-DATA".to_string())?;
            emit_phase_event(journal, deps.transport, &job, &deps.device_id, SendPhase::DataCompleted)?;
            let rows = journal.load_recipients(&send_job_id, generation)?;
            let per_recipient = rows.iter().map(recipient_state_value).collect();
            let sanitized = contract::SanitizedResponse {
                smtp_code: Some(code),
                enhanced_code: None,
                response_class: ResponseClass::Accepted,
            };
            let queue_id = provider_queue_id_of(&message);
            session.quit();
            settle(
                journal,
                deps.transport,
                &job,
                &deps.device_id,
                "submitted",
                per_recipient,
                Some(&sanitized),
                queue_id.as_deref(),
                "none",
            )
        }
        Err(failure) => handle_transaction_failure(
            deps, journal, &send_job_id, generation, attempt, grant, failure,
        ),
    }
}

fn provider_credentials(
    profile: &SenderProfile,
    secrets: &dyn SecretResolver,
) -> Result<Option<SmtpCredentials>, String> {
    let Some(username) = profile.username.clone() else {
        return Ok(None);
    };
    let Some(locator) = profile.secret_locator.as_deref() else {
        return Ok(None);
    };
    match secrets.resolve_locator(locator) {
        Ok(Some(secret)) => Ok(Some(SmtpCredentials { username, secret })),
        Ok(None) | Err(_) => Ok(None),
    }
}

fn handle_transaction_failure(
    deps: &SubmissionDeps<'_>,
    journal: &mut EmailJournal,
    send_job_id: &str,
    generation: u32,
    attempt: u32,
    grant: &PrepareGrant,
    failure: SmtpFailure,
) -> Result<SubmissionResult, String> {
    // Cancel/fence honored strictly before DATA (hook aborts).
    if failure.local_detail == "cancel_requested" {
        journal.finish_attempt(
            send_job_id,
            generation,
            attempt,
            SendPhase::MailFromSent.as_str(),
            "cancelled",
        )?;
        let job = journal
            .load_job(send_job_id, generation)?
            .ok_or_else(|| "job vanished on cancel".to_string())?;
        let rows = journal.load_recipients(send_job_id, generation)?;
        let per_recipient = rows.iter().map(recipient_state_value).collect();
        return settle(
            journal,
            deps.transport,
            &job,
            &deps.device_id,
            "cancelled",
            per_recipient,
            None,
            None,
            "cancelled",
        );
    }
    if failure.local_detail.starts_with("lease_")
        || failure.local_detail.starts_with("renew_failed:")
        || failure.local_detail == "superseded"
    {
        journal.finish_attempt(
            send_job_id,
            generation,
            attempt,
            SendPhase::MailFromSent.as_str(),
            "fenced",
        )?;
        return Ok(SubmissionResult::Abandoned(failure.local_detail));
    }

    if failure.at_or_after_data {
        // The delivery_unknown law (§6b.2/§10.1): ambiguity at/after DATA is
        // terminal delivery_unknown, never auto-retried.
        for recipient in &grant.envelope.recipients {
            journal.update_recipient_status(
                send_job_id,
                generation,
                &recipient.recipient_ref,
                "delivery_unknown",
                failure.smtp_code,
                failure.enhanced_code.as_deref(),
                Some(failure.response_class.as_str()),
                Some(&failure.local_detail),
                None,
            )?;
        }
        journal.finish_attempt(
            send_job_id,
            generation,
            attempt,
            SendPhase::DataStarted.as_str(),
            "delivery_unknown",
        )?;
        let job = journal
            .load_job(send_job_id, generation)?
            .ok_or_else(|| "job vanished post-DATA".to_string())?;
        let rows = journal.load_recipients(send_job_id, generation)?;
        let per_recipient = rows.iter().map(recipient_state_value).collect();
        return settle(
            journal,
            deps.transport,
            &job,
            &deps.device_id,
            "delivery_unknown",
            per_recipient,
            None,
            None,
            "delivery_unknown",
        );
    }

    match failure.response_class {
        ResponseClass::RejectedPermanent => {
            for recipient in &grant.envelope.recipients {
                journal.update_recipient_status(
                    send_job_id,
                    generation,
                    &recipient.recipient_ref,
                    "bounced",
                    failure.smtp_code,
                    failure.enhanced_code.as_deref(),
                    Some(failure.response_class.as_str()),
                    Some(&failure.local_detail),
                    None,
                )?;
            }
            journal.finish_attempt(
                send_job_id,
                generation,
                attempt,
                SendPhase::MailFromSent.as_str(),
                "provider_rejected",
            )?;
            let job = journal
                .load_job(send_job_id, generation)?
                .ok_or_else(|| "job vanished on rejection".to_string())?;
            let rows = journal.load_recipients(send_job_id, generation)?;
            let per_recipient = rows.iter().map(recipient_state_value).collect();
            let sanitized = contract::SanitizedResponse {
                smtp_code: failure.smtp_code,
                enhanced_code: failure.enhanced_code.clone(),
                response_class: failure.response_class,
            };
            settle(
                journal,
                deps.transport,
                &job,
                &deps.device_id,
                "provider_rejected",
                per_recipient,
                Some(&sanitized),
                None,
                "policy",
            )
        }
        // Temporary/transport failures pre-DATA: retry by class through the
        // reoffer path — never terminal here.
        class => {
            journal.finish_attempt(
                send_job_id,
                generation,
                attempt,
                SendPhase::Connecting.as_str(),
                class.as_str(),
            )?;
            Ok(SubmissionResult::Abandoned(format!(
                "transient:{}",
                class.as_str()
            )))
        }
    }
}

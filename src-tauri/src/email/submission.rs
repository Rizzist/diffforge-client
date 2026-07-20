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

use secrecy::ExposeSecret;
use serde_json::{json, Map, Value};

use super::cloud_transport::{EmailCloudTransport, PrepareGrant, PrepareOutcome, RenewOutcome};
use super::contract::{self, ResponseClass, SendPhase};
use super::credentials::SecretResolver;
use super::email_killpoint;
use super::journal::{EmailJournal, PendingEventRow, RecipientRow, SendJobRow};
use super::mime::verify_mime;
use super::profiles::{binding_profile_ref, load_profile, SenderProfile};
use super::smtp_session::{SmtpCredentials, SmtpFailure, SmtpSecurity, SmtpSession, SmtpTarget};

pub const DEFAULT_EHLO: &str = "device.diffforge.local";

pub struct SubmissionDeps<'a> {
    pub transport: &'a dyn EmailCloudTransport,
    pub secrets: &'a dyn SecretResolver,
    pub device_id: String,
    /// Extra TLS trust anchor for the provider session (tests only).
    pub extra_root_cert_pem: Option<String>,
    /// Socket-level connect override (tests dial the sink; None in prod).
    pub connect_host_override: Option<String>,
    /// MX resolver override for native delivery (tests inject the in-memory
    /// fake; None = live Hickory resolution).
    pub native_mx: Option<&'a dyn super::mx::MxResolver>,
    /// Native SMTP port override (tests dial the loopback sink; None = 25).
    pub native_port_override: Option<u16>,
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
    map.insert(
        "schema_version".into(),
        json!(contract::EMAIL_SCHEMA_VERSION),
    );
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
    let status_event_id = uuid::Uuid::now_v7().to_string();
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
    journal.insert_send_event(
        &job.send_job_id,
        job.generation,
        phase,
        &status_event_id,
        &payload,
    )?;
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
    let status_event_id = uuid::Uuid::now_v7().to_string();
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
    let inserted = journal.journal_terminal(&job.send_job_id, job.generation, outcome, &event)?;
    email_killpoint("post_journal_pre_report");
    if inserted {
        transport.emit_send_event(&payload)?;
        journal.mark_event_handed_off(&status_event_id)?;
        return Ok(SubmissionResult::Terminal(outcome.to_string()));
    }
    // Another worker already settled the pair: OUR payload was NOT journaled
    // and must never be reported (review #7). Re-hand the ORIGINAL journaled
    // settled event if the cloud has not acked it yet, and report the
    // journaled outcome.
    if let Some((original, outbox_state)) =
        journal.load_settled_event(&job.send_job_id, job.generation)?
    {
        if outbox_state != "acked" && transport.emit_send_event(&original.payload).is_ok() {
            journal.mark_event_handed_off(&original.status_event_id)?;
        }
    }
    let journaled_outcome = journal
        .load_job(&job.send_job_id, job.generation)?
        .and_then(|row| row.terminal_outcome)
        .or_else(|| {
            journal
                .tombstone(&job.send_job_id, job.generation)
                .ok()
                .flatten()
                .map(|(outcome, _, _)| outcome)
        })
        .unwrap_or_else(|| outcome.to_string());
    Ok(SubmissionResult::Terminal(journaled_outcome))
}

pub(crate) fn recipient_state_value(recipient: &RecipientRow) -> Value {
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
    // §10.1 / review #1 (CRITICAL): a generation that already crossed the
    // DATA boundary may NEVER re-enter SMTP. A duplicate wake / re-offer for
    // such a pair terminalizes it (delivery_unknown, or submitted when the
    // provider 2xx was persisted) BEFORE prepare — no path re-sends DATA.
    if job.data_started {
        if let Some((_, _, outcome)) =
            journal.recover_incomplete_pair(send_job_id, generation, &deps.device_id)?
        {
            // The terminal was journaled; hand the settled event (and any
            // other pending events for the pair) to the outbox.
            for event in journal.pending_events_for(send_job_id, generation)? {
                if deps.transport.emit_send_event(&event.payload).is_ok() {
                    journal.mark_event_handed_off(&event.status_event_id)?;
                }
            }
            return Ok(SubmissionResult::Terminal(outcome));
        }
        // Another path settled it first — the pair is terminal either way.
        return Ok(SubmissionResult::NotRunnable(
            "data_boundary_crossed".to_string(),
        ));
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
    emit_phase_event(
        journal,
        deps.transport,
        &job,
        &deps.device_id,
        SendPhase::Prepared,
    )?;
    email_killpoint("post_lease_journaled");

    journal.advance_phase(&send_job_id, generation, SendPhase::LeaseHeld)?;
    job.phase = SendPhase::LeaseHeld.as_str().to_string();
    job.phase_rank = SendPhase::LeaseHeld.rank();
    emit_phase_event(
        journal,
        deps.transport,
        &job,
        &deps.device_id,
        SendPhase::LeaseHeld,
    )?;

    // ---- download ----
    journal.advance_phase(&send_job_id, generation, SendPhase::Downloading)?;
    job.phase = SendPhase::Downloading.as_str().to_string();
    job.phase_rank = SendPhase::Downloading.rank();
    emit_phase_event(
        journal,
        deps.transport,
        &job,
        &deps.device_id,
        SendPhase::Downloading,
    )?;
    let mime_bytes = match deps
        .transport
        .download_mime(&grant.mime_path, &grant.mime_transfer_id)
    {
        Ok(bytes) => bytes,
        Err(error) => {
            return Ok(SubmissionResult::Abandoned(format!(
                "download_failed:{error}"
            )))
        }
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
    emit_phase_event(
        journal,
        deps.transport,
        &job,
        &deps.device_id,
        SendPhase::Verified,
    )?;
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
    // INSERT-only seeding (review R2-4): rows carrying an outcome from a
    // previous execution of this generation are preserved, never reset.
    journal.seed_recipients(&send_job_id, generation, &recipients)?;

    if grant.mode == "native" {
        return run_native_transaction(deps, journal, job, &grant, &mime_bytes);
    }
    run_provider_transaction(deps, journal, job, &grant, &mime_bytes)
}

/// Lease-aware, journaled native direct-to-MX delivery (review #11): drives
/// a leased native job end-to-end through the same §6b.2 ladder the provider
/// path uses. One recipient per SMTP transaction (native_delivery.rs); the
/// DATA boundary is journaled through the SAME `mark_data_started` FULL
/// write before any recipient's DATA, the §10.2 facts (lease, DKIM key,
/// source IP, port-25) are re-checked before every DATA, and ambiguity
/// at/after DATA settles delivery_unknown — never retransmitted.
fn run_native_transaction(
    deps: &SubmissionDeps<'_>,
    journal: &mut EmailJournal,
    job: SendJobRow,
    grant: &PrepareGrant,
    mime_bytes: &[u8],
) -> Result<SubmissionResult, String> {
    use super::native_delivery::{
        apply_rate_outcome, deliver_recipient, NativeDeps, NativePreDataFacts,
        NativeRecipientOutcome,
    };
    use rusqlite::OptionalExtension;
    use std::cell::Cell;

    let send_job_id = job.send_job_id.clone();
    let generation = job.generation;
    let Some(native) = grant.native.as_ref() else {
        return Ok(SubmissionResult::Abandoned(
            "native_grant_missing".to_string(),
        ));
    };

    // ---- active DKIM key (journal-held, §10.1) — must match the grant ----
    let key_row: Option<(String, String, String)> = journal
        .connection()
        .query_row(
            "SELECT selector, pubkey_fingerprint_sha256, secret_locator FROM email_dkim_keys
             WHERE domain = ?1 AND state = 'active'
             ORDER BY created_at_ms DESC LIMIT 1",
            [native.dkim_domain.as_str()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("native dkim key lookup failed: {error}"))?;
    let Some((selector, fingerprint, locator)) = key_row else {
        return Ok(SubmissionResult::Abandoned(
            "dkim_key_unavailable".to_string(),
        ));
    };
    if selector != native.dkim_selector
        || !fingerprint.eq_ignore_ascii_case(&native.dkim_pubkey_fingerprint)
    {
        // Grant/journal disagreement about the signing key: never sign with
        // the wrong key; re-qualification/preflight resolves it.
        return Ok(SubmissionResult::Abandoned(
            "dkim_key_unavailable".to_string(),
        ));
    }
    let dkim_key_pem = match deps.secrets.resolve_locator(&locator) {
        Ok(Some(secret)) => secret,
        Ok(None) | Err(_) => {
            return Ok(SubmissionResult::Abandoned(
                "dkim_key_unavailable".to_string(),
            ))
        }
    };
    // The RESOLVED private key's fingerprint is derived and compared — the
    // journal row's stored claim is never trusted (review R2-2): a rotated
    // or corrupted secret behind the same locator must not sign.
    match super::dkim::fingerprint_of_private_pem(dkim_key_pem.expose_secret()) {
        Ok(derived) if derived.eq_ignore_ascii_case(&native.dkim_pubkey_fingerprint) => {}
        _ => {
            return Ok(SubmissionResult::Abandoned(
                "dkim_key_unavailable".to_string(),
            ))
        }
    }

    // ---- renew the lease before entering SMTP (fence check) ----
    let lease_expires = Cell::new(grant.expires_at_ms);
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
            lease_expires.set(expires_at_ms);
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
                other => Ok(SubmissionResult::Abandoned(format!("lease_{other}"))),
            };
        }
        Err(error) => return Ok(SubmissionResult::Abandoned(format!("renew_failed:{error}"))),
    }

    journal.advance_phase(&send_job_id, generation, SendPhase::Connecting)?;
    {
        let job = journal
            .load_job(&send_job_id, generation)?
            .ok_or_else(|| "job vanished mid-run".to_string())?;
        emit_phase_event(
            journal,
            deps.transport,
            &job,
            &deps.device_id,
            SendPhase::Connecting,
        )?;
    }
    email_killpoint("pre_connect");

    let fallback_resolver = super::mx::HickoryMxResolver;
    let resolver: &dyn super::mx::MxResolver = deps.native_mx.unwrap_or(&fallback_resolver);

    // Rows carrying an outcome from a previous execution of THIS generation
    // are never retried (review R2-4): a permanent bounce stays bounced;
    // only pending/deferred recipients run.
    let skip_terminal: std::collections::BTreeSet<String> = journal
        .load_recipients(&send_job_id, generation)?
        .iter()
        .filter(|row| {
            matches!(
                row.status.as_str(),
                "submitted" | "bounced" | "delivery_unknown"
            )
        })
        .map(|row| row.recipient_ref.clone())
        .collect();

    // The hooks and the loop body share the journal sequentially (RefCell —
    // deliver_recipient invokes the hook strictly inline).
    let journal_cell = RefCell::new(journal);
    let deps_transport = deps.transport;
    // Hook-abort channel: before_data failures surface through the SMTP
    // failure classifier as opaque errors, so the hook records WHY it
    // aborted and the loop below acts on the recorded reason, never on the
    // misclassified outcome.
    let hook_abort: RefCell<Option<String>> = RefCell::new(None);

    // FRESH §10.2 facts, requeried/rederived on EVERY evaluation (review
    // R2-2): the newest egress observation (source IP + port-25 evidence)
    // and the credential store's CURRENT key material. Missing evidence
    // fails CLOSED — nothing defaults to true.
    let secrets = deps.secrets;
    let grant_fingerprint = native.dkim_pubkey_fingerprint.clone();
    let authorized_ips = native.authorized_ips.clone();
    let recheck_locator = locator.clone();
    let fresh_facts = || -> NativePreDataFacts {
        use rusqlite::OptionalExtension as _;
        let observation: Option<(String, Option<bool>)> = journal_cell
            .borrow()
            .connection()
            .query_row(
                "SELECT egress_ip, port25_open FROM email_egress_ip_observations
                 ORDER BY observed_at_ms DESC LIMIT 1",
                [],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<i64>>(1)?.map(|value| value != 0),
                    ))
                },
            )
            .optional()
            .ok()
            .flatten();
        let source_ip_authorized = if authorized_ips.is_empty() {
            true
        } else {
            observation
                .as_ref()
                .is_some_and(|(ip, _)| authorized_ips.iter().any(|allowed| allowed == ip))
        };
        let port25_reachable = observation
            .as_ref()
            .and_then(|(_, port25)| *port25)
            .unwrap_or(false);
        let dkim_fingerprint_matches = secrets
            .resolve_locator(&recheck_locator)
            .ok()
            .flatten()
            .and_then(|pem| super::dkim::fingerprint_of_private_pem(pem.expose_secret()).ok())
            .is_some_and(|derived| derived.eq_ignore_ascii_case(&grant_fingerprint));
        NativePreDataFacts {
            source_ip_authorized,
            lease_valid: now_ms() < lease_expires.get(),
            dkim_fingerprint_matches,
            port25_reachable,
        }
    };

    for recipient in &grant.envelope.recipients {
        if skip_terminal.contains(&recipient.recipient_ref) {
            continue;
        }
        let attempt = {
            let mut guard = journal_cell.borrow_mut();
            guard.begin_attempt(&send_job_id, generation, Some(&recipient.domain))?
        };
        let recheck = |_host: &str| fresh_facts();
        let native_deps = NativeDeps {
            mx: resolver,
            dkim_key_pem: dkim_key_pem.clone(),
            dkim_domain: native.dkim_domain.clone(),
            dkim_selector: native.dkim_selector.clone(),
            ehlo: native.ehlo.clone(),
            extra_root_cert_pem: deps.extra_root_cert_pem.clone(),
            connect_host_override: deps.connect_host_override.clone(),
            connect_port_override: deps.native_port_override,
            recheck_facts: &recheck,
        };
        let before_data = || -> Result<(), String> {
            // §10.2: every DATA is preceded by FRESH fact rechecks — source
            // IP, lease, DKIM key, port-25 — evaluated NOW, not at run start
            // (review R2-2). fresh_facts fails closed on missing evidence.
            let facts = fresh_facts();
            if !facts.all_ok() {
                let check = facts.first_failure().unwrap_or("unknown");
                let reason = format!("native_preflight_recheck:{check}");
                *hook_abort.borrow_mut() = Some(reason.clone());
                return Err(reason);
            }
            let mut guard = journal_cell.borrow_mut();
            let journal: &mut EmailJournal = &mut *guard;
            let job = journal
                .load_job(&send_job_id, generation)
                .map_err(|error| format!("native pre-DATA check failed: {error}"))?
                .ok_or_else(|| "job vanished before DATA".to_string())?;
            // Cancel honored strictly before the FIRST data_started.
            if job.cancel_requested && !job.data_started {
                *hook_abort.borrow_mut() = Some("cancel_requested".to_string());
                return Err("cancel_requested".to_string());
            }
            if job.superseded {
                *hook_abort.borrow_mut() = Some("superseded".to_string());
                return Err("superseded".to_string());
            }
            let first_crossing = !job.data_started;
            // Renew the fence one last time before this recipient's DATA.
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
                    lease_expires.set(expires_at_ms);
                }
                Ok(RenewOutcome::Refused { slug, .. }) => {
                    *hook_abort.borrow_mut() = Some(format!("lease_{slug}"));
                    return Err(format!("lease_{slug}"));
                }
                Err(error) => {
                    *hook_abort.borrow_mut() = Some(format!("renew_failed:{error}"));
                    return Err(format!("renew_failed:{error}"));
                }
            }
            journal
                .mark_data_started(&send_job_id, generation)
                .map_err(|error| format!("data_started journal failed: {error}"))?;
            email_killpoint("post_data_started_journal");
            if first_crossing {
                if let Ok(Some(job)) = journal.load_job(&send_job_id, generation) {
                    let _ = emit_phase_event(
                        journal,
                        deps_transport,
                        &job,
                        &deps.device_id,
                        SendPhase::DataStarted,
                    );
                }
            }
            Ok(())
        };
        let delivered = deliver_recipient(
            &native_deps,
            &recipient.address,
            &recipient.domain,
            &grant.envelope.mail_from,
            mime_bytes,
            0,
            before_data,
        );
        let abort_reason = hook_abort.borrow_mut().take();
        let outcome = match delivered {
            Ok(outcome) => outcome,
            Err(error) => {
                // Infrastructure error (DKIM signing / MX transport): the
                // recipient was never attempted on the wire — defer it.
                let mut guard = journal_cell.borrow_mut();
                guard.finish_attempt(
                    &send_job_id,
                    generation,
                    attempt,
                    SendPhase::Connecting.as_str(),
                    "native_error",
                )?;
                guard.record_recipient_outcome_full(
                    &send_job_id,
                    generation,
                    &recipient.recipient_ref,
                    "deferred",
                    None,
                    Some("deferred"),
                    Some(&error.chars().take(300).collect::<String>()),
                    None,
                )?;
                crate::log_terminal_status_event(
                    "backend.email.native_recipient_error",
                    json!({
                        "send_job_id": send_job_id,
                        "generation": generation,
                        "recipient_ref": recipient.recipient_ref,
                        "error": error,
                    }),
                );
                continue;
            }
        };
        // A hook abort (cancel/fence/fact-recheck) misclassifies through the
        // SMTP layer — the recorded reason wins over the reported outcome.
        if let Some(reason) = abort_reason {
            let journal = journal_cell.into_inner();
            journal.finish_attempt(
                &send_job_id,
                generation,
                attempt,
                SendPhase::MailFromSent.as_str(),
                if reason == "cancel_requested" {
                    "cancelled"
                } else if reason.starts_with("native_preflight_recheck:") {
                    "preflight_recheck_failed"
                } else {
                    "fenced"
                },
            )?;
            if reason == "cancel_requested" {
                let job = journal
                    .load_job(&send_job_id, generation)?
                    .ok_or_else(|| "job vanished on cancel".to_string())?;
                let rows = journal.load_recipients(&send_job_id, generation)?;
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
            // §6b.1 / review R2-3: once ANY recipient crossed DATA, the pair
            // terminalizes NOW (partially_submitted / delivery_unknown from
            // the journaled rows) — never a nonterminal Abandoned that could
            // strand a data_started job.
            let crossed = journal
                .load_job(&send_job_id, generation)?
                .map(|row| row.data_started)
                .unwrap_or(false);
            if crossed {
                return settle_native_from_rows(deps, journal, &send_job_id, generation);
            }
            return Ok(SubmissionResult::Abandoned(reason));
        }
        {
            let mut guard = journal_cell.borrow_mut();
            let journal: &mut EmailJournal = &mut *guard;
            match &outcome {
                NativeRecipientOutcome::PreflightAborted { check } => {
                    journal.finish_attempt(
                        &send_job_id,
                        generation,
                        attempt,
                        SendPhase::Connecting.as_str(),
                        "preflight_recheck_failed",
                    )?;
                    drop(guard);
                    let journal = journal_cell.into_inner();
                    // §10.2: a failed pre-DATA fact abort is not a wire
                    // event for THIS recipient — but if an earlier recipient
                    // already crossed DATA, the pair terminalizes now
                    // (review R2-3); otherwise stop non-terminally for
                    // re-qualification.
                    let crossed = journal
                        .load_job(&send_job_id, generation)?
                        .map(|row| row.data_started)
                        .unwrap_or(false);
                    if crossed {
                        return settle_native_from_rows(deps, journal, &send_job_id, generation);
                    }
                    return Ok(SubmissionResult::Abandoned(format!(
                        "native_preflight_recheck:{check}"
                    )));
                }
                NativeRecipientOutcome::Submitted { smtp_code } => {
                    // FULL-durability at the recipient's 2xx (review R2-3):
                    // this row is the crash-survivable record recovery uses
                    // to keep the recipient `submitted`.
                    journal.record_recipient_outcome_full(
                        &send_job_id,
                        generation,
                        &recipient.recipient_ref,
                        "submitted",
                        Some(*smtp_code),
                        Some("accepted"),
                        None,
                        None,
                    )?;
                    email_killpoint("post_native_recipient_submitted");
                    journal.finish_attempt(
                        &send_job_id,
                        generation,
                        attempt,
                        SendPhase::DataCompleted.as_str(),
                        "submitted",
                    )?;
                    apply_rate_outcome(journal, &recipient.domain, &outcome)?;
                }
                NativeRecipientOutcome::Deferred { retry_at_ms } => {
                    journal.record_recipient_outcome_full(
                        &send_job_id,
                        generation,
                        &recipient.recipient_ref,
                        "deferred",
                        None,
                        Some("deferred"),
                        None,
                        *retry_at_ms,
                    )?;
                    journal.finish_attempt(
                        &send_job_id,
                        generation,
                        attempt,
                        SendPhase::MailFromSent.as_str(),
                        "deferred",
                    )?;
                    apply_rate_outcome(journal, &recipient.domain, &outcome)?;
                }
                NativeRecipientOutcome::Bounced { smtp_code } => {
                    journal.record_recipient_outcome_full(
                        &send_job_id,
                        generation,
                        &recipient.recipient_ref,
                        "bounced",
                        *smtp_code,
                        Some("rejected_permanent"),
                        None,
                        None,
                    )?;
                    journal.finish_attempt(
                        &send_job_id,
                        generation,
                        attempt,
                        SendPhase::MailFromSent.as_str(),
                        "bounced",
                    )?;
                }
                NativeRecipientOutcome::DeliveryUnknown => {
                    journal.record_recipient_outcome_full(
                        &send_job_id,
                        generation,
                        &recipient.recipient_ref,
                        "delivery_unknown",
                        None,
                        None,
                        Some("native delivery ambiguous at/after DATA"),
                        None,
                    )?;
                    journal.finish_attempt(
                        &send_job_id,
                        generation,
                        attempt,
                        SendPhase::DataStarted.as_str(),
                        "delivery_unknown",
                    )?;
                }
            }
        }
    }
    let journal = journal_cell.into_inner();
    settle_native_from_rows(deps, journal, &send_job_id, generation)
}

/// Aggregate a native run per §6b.1 from the JOURNALED recipient rows — the
/// single source that includes both this execution's outcomes and any
/// preserved rows from previous executions of the same generation (reviews
/// R2-3/R2-4). Terminal whenever the rows say so, and ALWAYS terminal once
/// the DATA boundary was crossed.
fn settle_native_from_rows(
    deps: &SubmissionDeps<'_>,
    journal: &mut EmailJournal,
    send_job_id: &str,
    generation: u32,
) -> Result<SubmissionResult, String> {
    let job = journal
        .load_job(send_job_id, generation)?
        .ok_or_else(|| "job vanished post-native-run".to_string())?;
    let rows = journal.load_recipients(send_job_id, generation)?;
    let any_unknown = rows.iter().any(|row| row.status == "delivery_unknown");
    let submitted_code = rows
        .iter()
        .find(|row| row.status == "submitted")
        .map(|row| row.smtp_code.unwrap_or(250));
    let all_submitted = !rows.is_empty() && rows.iter().all(|row| row.status == "submitted");
    let all_bounced = !rows.is_empty() && rows.iter().all(|row| row.status == "bounced");
    let per_recipient: Vec<Value> = rows.iter().map(recipient_state_value).collect();

    if any_unknown {
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
    if let Some(best_code) = submitted_code {
        // Provider acceptance journaled BEFORE reported; recipient rows
        // already carry their FULL-durability outcomes (pass None).
        journal.mark_data_completed(send_job_id, generation, Some(best_code), "accepted", None)?;
        email_killpoint("post_data_completed_journal");
        let job = journal
            .load_job(send_job_id, generation)?
            .ok_or_else(|| "job vanished post-DATA".to_string())?;
        let sanitized = contract::SanitizedResponse {
            smtp_code: Some(best_code),
            enhanced_code: None,
            response_class: ResponseClass::Accepted,
        };
        return settle(
            journal,
            deps.transport,
            &job,
            &deps.device_id,
            if all_submitted {
                "submitted"
            } else {
                "partially_submitted"
            },
            per_recipient,
            Some(&sanitized),
            None,
            "none",
        );
    }
    if all_bounced {
        return settle(
            journal,
            deps.transport,
            &job,
            &deps.device_id,
            "provider_rejected",
            per_recipient,
            None,
            None,
            "policy",
        );
    }
    // Only deferrals/pending remain — non-terminal when the DATA boundary
    // was never crossed; once crossed, the pair may never re-enter SMTP
    // (§10.1) and settles delivery_unknown.
    if job.data_started {
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
    Ok(SubmissionResult::Abandoned("native_deferred".to_string()))
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
    let credentials = match provider_credentials(&profile, deps.secrets) {
        ProviderCredentials::Unauthenticated => None,
        ProviderCredentials::Available(credentials) => Some(credentials),
        ProviderCredentials::Unavailable(reason) => {
            // Configured-but-unavailable credentials stop the run BEFORE any
            // SMTP traffic (review #13): never a silent no-AUTH session,
            // never a fake provider rejection. Non-terminal — the cloud's
            // credential_required → released → re-offer path re-executes it
            // once credentials are restored (§6b.1).
            crate::log_terminal_status_event(
                "backend.email.credentials_unavailable",
                json!({
                    "send_job_id": send_job_id,
                    "generation": generation,
                    "reason": reason,
                }),
            );
            let attempt = journal.begin_attempt(&send_job_id, generation, None)?;
            journal.finish_attempt(
                &send_job_id,
                generation,
                attempt,
                SendPhase::Verified.as_str(),
                "credential_failure",
            )?;
            return Ok(SubmissionResult::Abandoned("credential_failure".to_string()));
        }
    };
    let Some(smtp_host) = profile.smtp_host.clone() else {
        return Ok(SubmissionResult::Abandoned(
            "profile_incomplete".to_string(),
        ));
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
    emit_phase_event(
        journal,
        deps.transport,
        &job,
        &deps.device_id,
        SendPhase::Connecting,
    )?;
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
            // 2xx journaled BEFORE reported — and the recipient rows flip to
            // `submitted` in the SAME transaction (review #8): a crash can
            // never leave a persisted provider acceptance alongside
            // `pending` recipient rows.
            journal.mark_data_completed(
                &send_job_id,
                generation,
                Some(code),
                "accepted",
                Some(&message.chars().take(300).collect::<String>()),
            )?;
            email_killpoint("post_data_completed_journal");
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
            emit_phase_event(
                journal,
                deps.transport,
                &job,
                &deps.device_id,
                SendPhase::DataCompleted,
            )?;
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
            deps,
            journal,
            &send_job_id,
            generation,
            attempt,
            grant,
            failure,
        ),
    }
}

/// Tri-state credential resolution (review #13): a profile that CONFIGURED
/// credentials (username, locator, or the has_credentials flag) but cannot
/// resolve them right now must STOP before SMTP — silently proceeding
/// without AUTH would either attempt unauthenticated delivery or misreport a
/// locked/deleted secret as a provider rejection. Only a profile with
/// neither a username nor a locator (nor the flag) is explicitly
/// unauthenticated.
enum ProviderCredentials {
    Unauthenticated,
    Available(SmtpCredentials),
    Unavailable(String),
}

fn provider_credentials(
    profile: &SenderProfile,
    secrets: &dyn SecretResolver,
) -> ProviderCredentials {
    match (profile.username.clone(), profile.secret_locator.as_deref()) {
        (None, None) => {
            if profile.has_credentials {
                ProviderCredentials::Unavailable(
                    "profile marks has_credentials but stores no locator".to_string(),
                )
            } else {
                ProviderCredentials::Unauthenticated
            }
        }
        (Some(username), Some(locator)) => match secrets.resolve_locator(locator) {
            Ok(Some(secret)) => ProviderCredentials::Available(SmtpCredentials { username, secret }),
            Ok(None) => ProviderCredentials::Unavailable(
                "configured credential missing from the store".to_string(),
            ),
            Err(error) => {
                ProviderCredentials::Unavailable(format!("credential store error: {error}"))
            }
        },
        (Some(_), None) => ProviderCredentials::Unavailable(
            "username configured without a stored secret".to_string(),
        ),
        (None, Some(_)) => ProviderCredentials::Unavailable(
            "stored secret configured without a username".to_string(),
        ),
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
            // Exception (review #1): once `data_started` is committed the
            // pair may NEVER re-enter SMTP — a temporary refusal arriving
            // after the boundary (e.g. a clean 4xx to the DATA command)
            // settles delivery_unknown NOW instead of abandoning into a
            // reoffer that could not run anyway.
            let data_started = journal
                .load_job(send_job_id, generation)?
                .map(|row| row.data_started)
                .unwrap_or(false);
            if data_started {
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
            Ok(SubmissionResult::Abandoned(format!(
                "transient:{}",
                class.as_str()
            )))
        }
    }
}

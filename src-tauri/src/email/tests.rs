//! Cross-module email tests: journal laws, the submission matrix against
//! the local SMTP sink, the plan-§6 device crash matrix via killpoint
//! subprocesses, fixture shape checks against the frozen email-v1 corpus,
//! and the intake wiring guards. Per the track rules everything here runs
//! against loopback fakes — no live infrastructure.

use serde_json::{json, Value};

use super::cloud_transport::PrepareOutcome;
use super::contract::{self, SendPhase};
use super::credentials::{CredentialStore, MemoryCredentialStore};
use super::journal::{CommandIntake, EmailJournal, PendingEventRow, RecipientRow};
use super::profiles;
use super::remote::{journal_command_before_ack, IntakeAck};
use super::submission::{run_send_job, SubmissionDeps, SubmissionResult};
use super::test_support::{
    leased_grant_for, FakeCloudTransport, SinkBehavior, SinkMode, SmtpSink, SINK_TLS_CERT_PEM,
};

fn temp_dir(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "diffforge-email-{tag}-{}-{}",
        std::process::id(),
        uuid::Uuid::now_v7()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn open_journal(dir: &std::path::Path) -> EmailJournal {
    EmailJournal::open_at(&dir.join("journal.sqlite")).unwrap()
}

const TEST_MIME: &[u8] = b"From: Acme Ops <ops@acme.example>\r\nTo: billing@partner.example\r\nSubject: invoice\r\nDate: Mon, 20 Jul 2026 00:00:00 +0000\r\nMessage-ID: <t1@acme.example>\r\n\r\nhello\r\n";

/// Two-recipient variant for the native multi-recipient matrix (R2-3/R2-4).
const TEST_MIME_TWO_RCPT: &[u8] = b"From: Acme Ops <ops@acme.example>\r\nTo: billing@partner.example, legal@partner.example\r\nSubject: invoice\r\nDate: Mon, 20 Jul 2026 00:00:00 +0000\r\nMessage-ID: <t2@acme.example>\r\n\r\nhello\r\n";

fn now_plus_two_minutes() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
        + 120_000
}

/// Journal a wake command + seed profile/binding/credentials so run_send_job
/// can go end-to-end against a sink.
fn seed_send_job(
    journal: &mut EmailJournal,
    memory: &MemoryCredentialStore,
    sink_port: u16,
) -> (String, u32) {
    let send_job_id = format!("job-{}", uuid::Uuid::now_v7());
    let command = contract::parse_email_command(
        contract::EMAIL_COMMAND_SEND,
        &json!({
            "command_id": contract::email_send_command_id(&send_job_id, 1),
            "send_job_id": send_job_id,
            "generation": 1,
            "binding_id": "bind-1",
            "target_device_id": "device-test",
        }),
    )
    .unwrap();
    let ack = journal_command_before_ack(journal, &command, "live_intake", "device-test").unwrap();
    assert_eq!(ack.result, "accepted");

    let locator = memory
        .set("profile-test", &secrecy::SecretString::from("app-password"))
        .unwrap();
    journal
        .connection()
        .execute(
            "INSERT OR REPLACE INTO email_sender_profiles
             (profile_ref, mode, smtp_host, smtp_port, smtp_security, username,
              secret_locator, has_credentials, created_at_ms, updated_at_ms)
             VALUES ('profile-test', 'provider', 'localhost', ?1, 'starttls',
                     'user@acme.example', ?2, 1, 1, 1)",
            rusqlite::params![sink_port, locator],
        )
        .unwrap();
    profiles::store_bindings_cache(
        journal,
        &json!([{ "binding_id": "bind-1", "profile_ref": "profile-test" }]),
    )
    .unwrap();
    (send_job_id, 1)
}

fn deps<'a>(
    transport: &'a FakeCloudTransport,
    memory: &'a MemoryCredentialStore,
) -> SubmissionDeps<'a> {
    SubmissionDeps {
        transport,
        secrets: memory,
        device_id: "device-test".to_string(),
        extra_root_cert_pem: Some(SINK_TLS_CERT_PEM.to_string()),
        connect_host_override: Some("127.0.0.1".to_string()),
        native_mx: None,
        native_port_override: None,
    }
}

// =====================================================================
// Journal laws
// =====================================================================

#[test]
fn journal_migrations_are_idempotent_and_marker_last() {
    let dir = temp_dir("migration");
    {
        let journal = open_journal(&dir);
        assert_eq!(journal.schema_version().unwrap(), 1);
    }
    // Reopen: nothing re-applies, version stable.
    {
        let journal = open_journal(&dir);
        assert_eq!(journal.schema_version().unwrap(), 1);
    }
    // Simulate a crash between DDL and marker: delete the marker row; the
    // idempotent DDL must replay cleanly on the next open and re-stamp.
    {
        let journal = open_journal(&dir);
        journal
            .connection()
            .execute("DELETE FROM email_schema_migrations", [])
            .unwrap();
    }
    {
        let journal = open_journal(&dir);
        assert_eq!(journal.schema_version().unwrap(), 1);
        // The journal's data survived the replay.
        let health = journal.health_check().unwrap();
        assert_eq!(health["ok"], true);
    }
}

#[test]
fn tombstone_law_survives_restart_and_gates_compaction() {
    let dir = temp_dir("tombstone");
    let send_job_id = "job-ts";
    {
        let mut journal = open_journal(&dir);
        journal
            .record_send_command(
                send_job_id,
                1,
                "email-send:job-ts:1",
                "bind-1",
                "hash-a",
                "test",
                |_| json!({"p": 1}),
            )
            .unwrap();
        let event = PendingEventRow {
            status_event_id: "evt-settled".to_string(),
            send_job_id: send_job_id.to_string(),
            generation: 1,
            payload: json!({"phase": "settled"}),
        };
        assert!(journal
            .journal_terminal(send_job_id, 1, "submitted", &event)
            .unwrap());
        // Compaction attempt WITHOUT the generation-retired ack: no-op.
        assert_eq!(journal.compact_retired_tombstones().unwrap(), 0);
        let (outcome, acked, compacted) = journal.tombstone(send_job_id, 1).unwrap().unwrap();
        assert_eq!(outcome, "submitted");
        assert!(!acked);
        assert!(!compacted);
    }
    // Across restart the tombstone still dominates redelivery.
    {
        let mut journal = open_journal(&dir);
        let intake = journal
            .record_send_command(
                send_job_id,
                1,
                "email-send:job-ts:1",
                "bind-1",
                "hash-a",
                "test",
                |_| json!({"p": 1}),
            )
            .unwrap();
        assert!(matches!(
            intake,
            CommandIntake::Duplicate { .. } | CommandIntake::Tombstoned { .. }
        ));
        // Ack the settled event as cloud-received, then retire + compact.
        journal.record_cloud_ack("evt-settled", true, None).unwrap();
        assert!(journal.record_generation_retired(send_job_id, 1).unwrap());
        // The intake-journaled `received` event still gates compaction until
        // its own ack lands (review #4: it exists from the intake txn).
        assert_eq!(journal.compact_retired_tombstones().unwrap(), 0);
        for entry in journal.pending_events_for(send_job_id, 1).unwrap() {
            journal
                .record_cloud_ack(&entry.status_event_id, true, None)
                .unwrap();
        }
        assert_eq!(journal.compact_retired_tombstones().unwrap(), 1);
        // The tombstone ROW itself survives compaction (no time-based
        // deletion, dominance persists); the bulky rows are gone.
        let (_, acked, compacted) = journal.tombstone(send_job_id, 1).unwrap().unwrap();
        assert!(acked);
        assert!(compacted);
        assert!(journal.load_job(send_job_id, 1).unwrap().is_none());
        // Post-compaction redelivery is still refused.
        let intake = journal
            .record_send_command(
                send_job_id,
                1,
                "email-send:job-ts:1",
                "bind-1",
                "hash-a",
                "test",
                |_| json!({"p": 1}),
            )
            .unwrap();
        assert!(matches!(
            intake,
            CommandIntake::Tombstoned { .. } | CommandIntake::Duplicate { .. }
        ));
    }
}

#[test]
fn compaction_waits_for_event_acks_even_after_retirement() {
    let dir = temp_dir("compaction-ack");
    let mut journal = open_journal(&dir);
    journal
        .record_send_command("job-c", 1, "email-send:job-c:1", "bind-1", "hash", "test", |_| json!({"p": 1}))
        .unwrap();
    let event = PendingEventRow {
        status_event_id: "evt-c".to_string(),
        send_job_id: "job-c".to_string(),
        generation: 1,
        payload: json!({"phase": "settled"}),
    };
    journal
        .journal_terminal("job-c", 1, "submitted", &event)
        .unwrap();
    journal.record_generation_retired("job-c", 1).unwrap();
    // The settled event is not cloud-acked yet: compaction must hold.
    assert_eq!(journal.compact_retired_tombstones().unwrap(), 0);
    journal
        .record_cloud_ack("evt-c", false, Some("stale_generation"))
        .unwrap();
    // The intake-journaled `received` event (review #4) still holds it.
    assert_eq!(journal.compact_retired_tombstones().unwrap(), 0);
    for entry in journal.pending_events_for("job-c", 1).unwrap() {
        journal
            .record_cloud_ack(&entry.status_event_id, true, None)
            .unwrap();
    }
    assert_eq!(journal.compact_retired_tombstones().unwrap(), 1);
}

#[test]
fn phase_ranks_never_regress() {
    let dir = temp_dir("phase");
    let mut journal = open_journal(&dir);
    journal
        .record_send_command("job-p", 1, "cmd", "bind-1", "hash", "test", |_| json!({"p": 1}))
        .unwrap();
    assert!(journal
        .advance_phase("job-p", 1, SendPhase::Downloading)
        .unwrap());
    assert!(!journal
        .advance_phase("job-p", 1, SendPhase::Prepared)
        .unwrap());
    let job = journal.load_job("job-p", 1).unwrap().unwrap();
    assert_eq!(job.phase, "downloading");
    assert_eq!(job.phase_rank, 4);
}

#[test]
fn cancel_window_closes_at_data_started() {
    let dir = temp_dir("cancel");
    let mut journal = open_journal(&dir);
    journal
        .record_send_command("job-x", 1, "cmd", "bind-1", "hash", "test", |_| json!({"p": 1}))
        .unwrap();
    assert!(journal.request_cancel("job-x", 1).unwrap().is_ok());
    // Reset for the second half: new job that reaches data_started.
    journal
        .record_send_command("job-y", 1, "cmd-y", "bind-1", "hash-y", "test", |_| json!({"p": 1}))
        .unwrap();
    journal.mark_data_started("job-y", 1).unwrap();
    let refused = journal.request_cancel("job-y", 1).unwrap();
    assert_eq!(refused.unwrap_err(), "data_boundary_crossed");
}

#[test]
fn recovery_classifies_per_crash_matrix() {
    let dir = temp_dir("recovery");
    let mut journal = open_journal(&dir);
    // Job A: data_started, nothing persisted → delivery_unknown.
    journal
        .record_send_command("job-a", 1, "cmd-a", "bind-1", "hash-a", "test", |_| json!({"p": 1}))
        .unwrap();
    journal
        .replace_recipients(
            "job-a",
            1,
            &[RecipientRow {
                recipient_ref: "r1".to_string(),
                role: "to".to_string(),
                address: "a@b.example".to_string(),
                domain: "b.example".to_string(),
                status: "pending".to_string(),
                smtp_code: None,
                enhanced_code: None,
                response_class: None,
                response_sanitized: None,
                retry_at_ms: None,
            }],
        )
        .unwrap();
    journal.mark_data_started("job-a", 1).unwrap();
    // Job B: data_completed with persisted 250 → terminal-if-persisted.
    journal
        .record_send_command("job-b", 1, "cmd-b", "bind-1", "hash-b", "test", |_| json!({"p": 1}))
        .unwrap();
    journal.mark_data_started("job-b", 1).unwrap();
    journal
        .mark_data_completed("job-b", 1, Some(250), "accepted", None)
        .unwrap();
    // Job C: pre-DATA (downloading) → left resumable.
    journal
        .record_send_command("job-c", 1, "cmd-c", "bind-1", "hash-c", "test", |_| json!({"p": 1}))
        .unwrap();
    journal
        .advance_phase("job-c", 1, SendPhase::Downloading)
        .unwrap();

    let settled = journal.recover_after_restart("device-test").unwrap();
    let by_job: std::collections::BTreeMap<String, String> = settled
        .iter()
        .map(|(job, _, outcome)| (job.clone(), outcome.clone()))
        .collect();
    assert_eq!(
        by_job.get("job-a").map(String::as_str),
        Some("delivery_unknown")
    );
    assert_eq!(by_job.get("job-b").map(String::as_str), Some("submitted"));
    assert!(
        !by_job.contains_key("job-c"),
        "pre-DATA jobs stay resumable"
    );
    // delivery_unknown is tombstoned — never auto-retried.
    assert!(journal.tombstone("job-a", 1).unwrap().is_some());
    // Pre-DATA job appears in resume summaries.
    let summaries = journal.resume_summaries().unwrap();
    assert!(summaries
        .iter()
        .any(|entry| entry["send_job_id"] == "job-c" && entry["phase"] == "downloading"));
}

// =====================================================================
// Submission matrix vs the SMTP sink
// =====================================================================

fn scripted_prepare(transport: &FakeCloudTransport, mode: &str) {
    transport.put_mime("mime://job", TEST_MIME.to_vec());
    transport.script_prepare(Ok(leased_grant_for(
        "mime://job",
        TEST_MIME,
        "bounce@acme.example",
        "ops@acme.example",
        &[("to", "billing@partner.example")],
        mode,
    )));
}

#[test]
fn provider_happy_path_journals_before_reporting() {
    let sink = SmtpSink::start(SinkMode::Plain, SinkBehavior::default());
    let dir = temp_dir("happy");
    let mut journal = open_journal(&dir);
    let memory = MemoryCredentialStore::new();
    let (send_job_id, generation) = seed_send_job(&mut journal, &memory, sink.port);
    let transport = FakeCloudTransport::new();
    scripted_prepare(&transport, "provider");

    let result = run_send_job(
        &deps(&transport, &memory),
        &mut journal,
        &send_job_id,
        generation,
    )
    .unwrap();
    assert_eq!(result, SubmissionResult::Terminal("submitted".to_string()));

    // The sink received exactly one TLS-protected authenticated message.
    let state = sink.state();
    assert_eq!(state.messages.len(), 1);
    assert!(state.messages[0].tls_active);
    assert!(state.messages[0].authenticated);
    assert!(!state.auth_before_tls);
    assert_eq!(state.messages[0].rcpt_to, vec!["billing@partner.example"]);

    // Journal: terminal + tombstone + persisted 2xx.
    let job = journal.load_job(&send_job_id, generation).unwrap().unwrap();
    assert_eq!(job.terminal_outcome.as_deref(), Some("submitted"));
    assert_eq!(job.last_smtp_code, Some(250));
    assert!(job.data_started);
    assert!(journal
        .tombstone(&send_job_id, generation)
        .unwrap()
        .is_some());

    // Events walked the ladder in rank order and settled exactly once.
    let phases = transport.event_phases();
    let ranks: Vec<u32> = phases
        .iter()
        .map(|phase| SendPhase::parse(phase).unwrap().rank())
        .collect();
    let mut sorted = ranks.clone();
    sorted.sort_unstable();
    assert_eq!(ranks, sorted, "phase events emit in rank order: {phases:?}");
    assert_eq!(phases.iter().filter(|phase| *phase == "settled").count(), 1);
    // The settled event carries per-recipient submitted + sanitized 250.
    let settled = transport
        .events()
        .into_iter()
        .find(|event| event["phase"] == "settled")
        .unwrap();
    assert_eq!(settled["error_class"], "none");
    assert_eq!(settled["per_recipient"][0]["delivery_state"], "submitted");
    assert_eq!(settled["response"]["smtp_code"], 250);
    assert_eq!(settled["response"]["response_class"], "accepted");
    assert!(settled.get("terminal").is_none(), "no terminal bool (§9.2)");
    // Free provider text NEVER crosses the wire (§9.6).
    let wire = settled.to_string();
    assert!(!wire.contains("queued as sink-0001"));
    // Re-running the settled pair is refused — tombstone dominates.
    let rerun = run_send_job(
        &deps(&transport, &memory),
        &mut journal,
        &send_job_id,
        generation,
    )
    .unwrap();
    assert!(matches!(rerun, SubmissionResult::NotRunnable(_)));
}

#[test]
fn auth_535_abandons_without_tombstone() {
    let behavior = SinkBehavior {
        auth_response: "535 5.7.8 authentication credentials invalid".to_string(),
        ..SinkBehavior::default()
    };
    let sink = SmtpSink::start(SinkMode::Plain, behavior);
    let dir = temp_dir("auth535");
    let mut journal = open_journal(&dir);
    let memory = MemoryCredentialStore::new();
    let (send_job_id, generation) = seed_send_job(&mut journal, &memory, sink.port);
    let transport = FakeCloudTransport::new();
    scripted_prepare(&transport, "provider");

    let result = run_send_job(
        &deps(&transport, &memory),
        &mut journal,
        &send_job_id,
        generation,
    )
    .unwrap();
    assert_eq!(
        result,
        SubmissionResult::Abandoned("credential_failure".to_string())
    );
    // NON-terminal: the same generation must be re-executable after the
    // cloud's credential_required → released → re-offer cycle (§6b.1).
    let job = journal.load_job(&send_job_id, generation).unwrap().unwrap();
    assert!(job.terminal_outcome.is_none());
    assert!(journal
        .tombstone(&send_job_id, generation)
        .unwrap()
        .is_none());
    assert!(!transport.event_phases().contains(&"settled".to_string()));
}

#[test]
fn rcpt_550_settles_provider_rejected() {
    let mut rcpt_responses = std::collections::BTreeMap::new();
    rcpt_responses.insert(
        "billing@partner.example".to_string(),
        "550 5.1.1 user unknown".to_string(),
    );
    let sink = SmtpSink::start(
        SinkMode::Plain,
        SinkBehavior {
            rcpt_responses,
            ..SinkBehavior::default()
        },
    );
    let dir = temp_dir("rcpt550");
    let mut journal = open_journal(&dir);
    let memory = MemoryCredentialStore::new();
    let (send_job_id, generation) = seed_send_job(&mut journal, &memory, sink.port);
    let transport = FakeCloudTransport::new();
    scripted_prepare(&transport, "provider");

    let result = run_send_job(
        &deps(&transport, &memory),
        &mut journal,
        &send_job_id,
        generation,
    )
    .unwrap();
    assert_eq!(
        result,
        SubmissionResult::Terminal("provider_rejected".to_string())
    );
    let settled = transport
        .events()
        .into_iter()
        .find(|event| event["phase"] == "settled")
        .unwrap();
    assert_eq!(settled["error_class"], "policy");
    assert_eq!(settled["per_recipient"][0]["delivery_state"], "bounced");
    assert_eq!(settled["per_recipient"][0]["response"]["smtp_code"], 550);
    assert_eq!(settled["data_started"], false, "rejected before DATA");
}

#[test]
fn lost_final_response_settles_delivery_unknown_never_retries() {
    let sink = SmtpSink::start(
        SinkMode::Plain,
        SinkBehavior {
            drop_after_data_before_response: true,
            ..SinkBehavior::default()
        },
    );
    let dir = temp_dir("unknown");
    let mut journal = open_journal(&dir);
    let memory = MemoryCredentialStore::new();
    let (send_job_id, generation) = seed_send_job(&mut journal, &memory, sink.port);
    let transport = FakeCloudTransport::new();
    scripted_prepare(&transport, "provider");

    let result = run_send_job(
        &deps(&transport, &memory),
        &mut journal,
        &send_job_id,
        generation,
    )
    .unwrap();
    assert_eq!(
        result,
        SubmissionResult::Terminal("delivery_unknown".to_string())
    );
    let job = journal.load_job(&send_job_id, generation).unwrap().unwrap();
    assert!(job.data_started);
    assert_eq!(job.terminal_outcome.as_deref(), Some("delivery_unknown"));
    let settled = transport
        .events()
        .into_iter()
        .find(|event| event["phase"] == "settled")
        .unwrap();
    assert_eq!(settled["error_class"], "delivery_unknown");
    assert_eq!(settled["data_started"], true);
    assert_eq!(
        settled["per_recipient"][0]["delivery_state"],
        "delivery_unknown"
    );
    // NEVER auto-retried: the tombstone refuses a re-run.
    let rerun = run_send_job(
        &deps(&transport, &memory),
        &mut journal,
        &send_job_id,
        generation,
    )
    .unwrap();
    assert!(matches!(rerun, SubmissionResult::NotRunnable(_)));
    // Only ONE message attempt ever hit the wire.
    assert!(
        sink.state()
            .transcript
            .iter()
            .filter(|line| line.starts_with("DATA"))
            .count()
            <= 1
    );
}

#[test]
fn cancel_before_data_settles_cancelled() {
    let sink = SmtpSink::start(SinkMode::Plain, SinkBehavior::default());
    let dir = temp_dir("cancel-run");
    let mut journal = open_journal(&dir);
    let memory = MemoryCredentialStore::new();
    let (send_job_id, generation) = seed_send_job(&mut journal, &memory, sink.port);
    journal
        .request_cancel(&send_job_id, generation)
        .unwrap()
        .unwrap();
    let transport = FakeCloudTransport::new();

    let result = run_send_job(
        &deps(&transport, &memory),
        &mut journal,
        &send_job_id,
        generation,
    )
    .unwrap();
    assert_eq!(result, SubmissionResult::Terminal("cancelled".to_string()));
    assert_eq!(sink.state().messages.len(), 0, "nothing sent");
    assert_eq!(*transport.prepare_calls.lock().unwrap(), 0);
}

#[test]
fn prepare_refusals_follow_the_ladder() {
    let dir = temp_dir("refusals");
    let memory = MemoryCredentialStore::new();

    // credential_required → non-terminal abandon.
    let mut journal = open_journal(&dir);
    let (job_a, _) = seed_send_job(&mut journal, &memory, 2525);
    let transport = FakeCloudTransport::new();
    transport.script_prepare(Ok(PrepareOutcome::Refused {
        slug: "credential_required".to_string(),
    }));
    let result = run_send_job(&deps(&transport, &memory), &mut journal, &job_a, 1).unwrap();
    assert_eq!(
        result,
        SubmissionResult::Abandoned("credential_required".to_string())
    );
    assert!(journal
        .load_job(&job_a, 1)
        .unwrap()
        .unwrap()
        .terminal_outcome
        .is_none());

    // cancelled → terminal cancelled.
    let (job_b, _) = seed_send_job(&mut journal, &memory, 2525);
    let transport = FakeCloudTransport::new();
    transport.script_prepare(Ok(PrepareOutcome::Refused {
        slug: "cancelled".to_string(),
    }));
    let result = run_send_job(&deps(&transport, &memory), &mut journal, &job_b, 1).unwrap();
    assert_eq!(result, SubmissionResult::Terminal("cancelled".to_string()));

    // superseded → terminal cancelled locally (tombstone dominates).
    let (job_c, _) = seed_send_job(&mut journal, &memory, 2525);
    let transport = FakeCloudTransport::new();
    transport.script_prepare(Ok(PrepareOutcome::Refused {
        slug: "superseded".to_string(),
    }));
    let result = run_send_job(&deps(&transport, &memory), &mut journal, &job_c, 1).unwrap();
    assert_eq!(result, SubmissionResult::Terminal("cancelled".to_string()));
    assert!(journal.tombstone(&job_c, 1).unwrap().is_some());
}

#[test]
fn lease_fence_stops_before_smtp_boundary() {
    use super::cloud_transport::RenewOutcome;
    let sink = SmtpSink::start(SinkMode::Plain, SinkBehavior::default());
    let dir = temp_dir("fence");
    let mut journal = open_journal(&dir);
    let memory = MemoryCredentialStore::new();
    let (send_job_id, generation) = seed_send_job(&mut journal, &memory, sink.port);
    let transport = FakeCloudTransport::new();
    scripted_prepare(&transport, "provider");
    transport.script_renew(Ok(RenewOutcome::Refused {
        slug: "fenced".to_string(),
        current_lease_epoch: Some(2),
    }));

    let result = run_send_job(
        &deps(&transport, &memory),
        &mut journal,
        &send_job_id,
        generation,
    )
    .unwrap();
    assert_eq!(
        result,
        SubmissionResult::Abandoned("lease_fenced".to_string())
    );
    assert_eq!(sink.state().messages.len(), 0, "fenced holder never sent");
    let job = journal.load_job(&send_job_id, generation).unwrap().unwrap();
    assert!(job.terminal_outcome.is_none(), "non-terminal for re-offer");
}

#[test]
fn mime_verification_failure_settles_failed_without_sending() {
    let sink = SmtpSink::start(SinkMode::Plain, SinkBehavior::default());
    let dir = temp_dir("verify-fail");
    let mut journal = open_journal(&dir);
    let memory = MemoryCredentialStore::new();
    let (send_job_id, generation) = seed_send_job(&mut journal, &memory, sink.port);
    let transport = FakeCloudTransport::new();
    // Grant advertises different bytes than the download returns.
    transport.script_prepare(Ok(leased_grant_for(
        "mime://job",
        TEST_MIME,
        "bounce@acme.example",
        "ops@acme.example",
        &[("to", "billing@partner.example")],
        "provider",
    )));
    transport.put_mime("mime://job", b"tampered bytes".to_vec());

    let result = run_send_job(
        &deps(&transport, &memory),
        &mut journal,
        &send_job_id,
        generation,
    )
    .unwrap();
    assert_eq!(result, SubmissionResult::Terminal("failed".to_string()));
    assert_eq!(
        sink.state().messages.len(),
        0,
        "unverified bytes never sent"
    );
}

// =====================================================================
// Crash matrix (kill -9 via killpoints, subprocess-driven)
// =====================================================================

/// Scenario runner: executed as a SUBPROCESS with DIFFFORGE_EMAIL_KILLPOINT
/// + EMAIL_KILLPOINT_SCENARIO set. Ignored in the normal suite.
#[test]
#[ignore]
fn killpoint_scenario_runner() {
    let Ok(config_json) = std::env::var("EMAIL_KILLPOINT_SCENARIO") else {
        eprintln!("killpoint runner invoked without scenario; skipping");
        return;
    };
    let config: Value = serde_json::from_str(&config_json).expect("scenario config");
    let journal_path = std::path::PathBuf::from(config["journal_path"].as_str().unwrap());
    let stage = config["stage"].as_str().unwrap_or("send");

    // The sink runs INSIDE the subprocess (loopback only). The mid-DATA
    // killpoint is SINK-driven (review #17): the sink aborts the process
    // only after observing real body bytes on the wire.
    let behavior = SinkBehavior {
        abort_process_at_body_byte: config["sink_abort_at_body_byte"]
            .as_u64()
            .map(|value| value as usize),
        ..SinkBehavior::default()
    };
    let sink = SmtpSink::start(SinkMode::Plain, behavior);
    let mut journal = EmailJournal::open_at(&journal_path).expect("journal open");
    let memory = MemoryCredentialStore::new();

    if stage == "intake" {
        // Only the intake write (killpoints pre_receipt_commit /
        // post_receipt_pre_ack fire inside).
        let command = contract::parse_email_command(
            contract::EMAIL_COMMAND_SEND,
            &json!({
                "command_id": "email-send:job-kill:1",
                "send_job_id": "job-kill",
                "generation": 1,
                "binding_id": "bind-1",
                "target_device_id": "device-test",
            }),
        )
        .unwrap();
        let _ = journal_command_before_ack(&mut journal, &command, "live_intake", "device-test");
        // Reaching here means the killpoint did not fire — the parent will
        // fail on exit-status expectations if it expected an abort.
        return;
    }

    let (send_job_id, generation) = seed_send_job(&mut journal, &memory, sink.port);
    std::fs::write(
        journal_path.with_extension("jobid"),
        format!("{send_job_id}:{generation}"),
    )
    .unwrap();
    let transport = FakeCloudTransport::new();
    scripted_prepare(&transport, "provider");
    let _ = run_send_job(
        &deps(&transport, &memory),
        &mut journal,
        &send_job_id,
        generation,
    );
}

struct KillpointExpectation {
    killpoint: &'static str,
    stage: &'static str,
    /// Expected recovery outcome for the pair: Some(outcome) means
    /// recover_after_restart settles it with that outcome; None means the
    /// job stays non-terminal (resumable) or terminal was already journaled.
    recovery_outcome: Option<&'static str>,
    /// Expect the job to already be terminal at reopen (journaled pre-crash).
    already_terminal: Option<&'static str>,
    /// Expect data_started to be set at reopen.
    data_started: bool,
    /// Sink-driven mid-DATA abort threshold (review #17): the subprocess
    /// sink kills the process after observing this many body bytes.
    sink_abort_at_body_byte: Option<usize>,
}

fn run_killpoint_case(case: &KillpointExpectation) {
    let dir = temp_dir(&format!("kill-{}", case.killpoint));
    let journal_path = dir.join("journal.sqlite");
    let scenario = json!({
        "journal_path": journal_path.display().to_string(),
        "stage": case.stage,
        "sink_abort_at_body_byte": case.sink_abort_at_body_byte,
    });
    let exe = std::env::current_exe().expect("test exe");
    let output = std::process::Command::new(&exe)
        .arg("email::tests::killpoint_scenario_runner")
        .arg("--exact")
        .arg("--ignored")
        .arg("--nocapture")
        .arg("--test-threads=1")
        .env("DIFFFORGE_EMAIL_KILLPOINT", case.killpoint)
        .env("EMAIL_KILLPOINT_SCENARIO", scenario.to_string())
        .output()
        .expect("spawn killpoint subprocess");
    assert!(
        !output.status.success(),
        "killpoint {} must abort the subprocess (stdout: {}, stderr: {})",
        case.killpoint,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr),
    );

    // Reopen the journal like a restarted device.
    let mut journal = EmailJournal::open_at(&journal_path).expect("journal reopen after crash");

    if case.stage == "intake" {
        match case.killpoint {
            "pre_receipt_commit" => {
                // Atomicity: neither receipt nor job row exists.
                let receipts: i64 = journal
                    .connection()
                    .query_row("SELECT COUNT(1) FROM email_command_receipts", [], |row| {
                        row.get(0)
                    })
                    .unwrap();
                assert_eq!(receipts, 0, "uncommitted intake leaves nothing");
                assert!(journal.load_job("job-kill", 1).unwrap().is_none());
            }
            "post_receipt_pre_ack" => {
                // Receipt + job exist; redelivery dedupes with the SAME
                // first_status_event_id (ack replay after crash-pre-ack).
                let job = journal.load_job("job-kill", 1).unwrap();
                assert!(job.is_some(), "receipt+job committed before ack");
                let command = contract::parse_email_command(
                    contract::EMAIL_COMMAND_SEND,
                    &json!({
                        "command_id": "email-send:job-kill:1",
                        "send_job_id": "job-kill",
                        "generation": 1,
                        "binding_id": "bind-1",
                        "target_device_id": "device-test",
                    }),
                )
                .unwrap();
                let ack =
                    journal_command_before_ack(&mut journal, &command, "replay", "device-test")
                        .unwrap();
                assert_eq!(ack.result, "duplicate");
                assert!(ack.first_status_event_id.is_some());
            }
            other => panic!("unknown intake killpoint {other}"),
        }
        return;
    }

    let job_ref =
        std::fs::read_to_string(journal_path.with_extension("jobid")).expect("job id marker");
    let (send_job_id, generation) = job_ref.split_once(':').unwrap();
    let generation: u32 = generation.trim().parse().unwrap();

    let job = journal
        .load_job(send_job_id, generation)
        .unwrap()
        .expect("job row survives the crash");
    assert_eq!(
        job.data_started, case.data_started,
        "data_started flag at reopen for {}",
        case.killpoint
    );
    if let Some(outcome) = case.already_terminal {
        assert_eq!(
            job.terminal_outcome.as_deref(),
            Some(outcome),
            "{}: terminal journaled before the crash",
            case.killpoint
        );
    } else {
        assert!(
            job.terminal_outcome.is_none(),
            "{}: no terminal before recovery",
            case.killpoint
        );
    }

    let settled = journal.recover_after_restart("device-test").unwrap();
    match case.recovery_outcome {
        Some(outcome) => {
            let entry = settled
                .iter()
                .find(|(job_id, gen, _)| job_id == send_job_id && *gen == generation)
                .unwrap_or_else(|| panic!("{}: recovery must settle the pair", case.killpoint));
            assert_eq!(entry.2, outcome, "{}: recovery outcome", case.killpoint);
            // delivery_unknown / submitted both tombstone — never re-run.
            assert!(journal
                .tombstone(send_job_id, generation)
                .unwrap()
                .is_some());
        }
        None => {
            assert!(
                !settled
                    .iter()
                    .any(|(job_id, gen, _)| job_id == send_job_id && *gen == generation),
                "{}: recovery must not settle the pair",
                case.killpoint
            );
        }
    }
}

#[test]
fn crash_matrix_intake_receipt_atomicity() {
    run_killpoint_case(&KillpointExpectation {
        killpoint: "pre_receipt_commit",
        stage: "intake",
        recovery_outcome: None,
        already_terminal: None,
        data_started: false,
        sink_abort_at_body_byte: None,
    });
}

#[test]
fn crash_matrix_pre_transport_ack() {
    run_killpoint_case(&KillpointExpectation {
        killpoint: "post_receipt_pre_ack",
        stage: "intake",
        recovery_outcome: None,
        already_terminal: None,
        data_started: false,
        sink_abort_at_body_byte: None,
    });
}

#[test]
fn crash_matrix_lease_receipt_is_resumable() {
    run_killpoint_case(&KillpointExpectation {
        killpoint: "post_lease_journaled",
        stage: "send",
        recovery_outcome: None,
        already_terminal: None,
        data_started: false,
        sink_abort_at_body_byte: None,
    });
}

#[test]
fn crash_matrix_post_download_is_resumable() {
    run_killpoint_case(&KillpointExpectation {
        killpoint: "post_download",
        stage: "send",
        recovery_outcome: None,
        already_terminal: None,
        data_started: false,
        sink_abort_at_body_byte: None,
    });
}

#[test]
fn crash_matrix_post_verify_is_resumable() {
    run_killpoint_case(&KillpointExpectation {
        killpoint: "post_verified",
        stage: "send",
        recovery_outcome: None,
        already_terminal: None,
        data_started: false,
        sink_abort_at_body_byte: None,
    });
}

#[test]
fn crash_matrix_post_auth_is_resumable() {
    run_killpoint_case(&KillpointExpectation {
        killpoint: "post_auth",
        stage: "send",
        recovery_outcome: None,
        already_terminal: None,
        data_started: false,
        sink_abort_at_body_byte: None,
    });
}

#[test]
fn crash_matrix_post_mail_from_is_resumable() {
    run_killpoint_case(&KillpointExpectation {
        killpoint: "post_mail_from",
        stage: "send",
        recovery_outcome: None,
        already_terminal: None,
        data_started: false,
        sink_abort_at_body_byte: None,
    });
}

#[test]
fn crash_matrix_data_started_commit_recovers_delivery_unknown() {
    run_killpoint_case(&KillpointExpectation {
        killpoint: "post_data_started_journal",
        stage: "send",
        recovery_outcome: Some("delivery_unknown"),
        already_terminal: None,
        data_started: true,
        sink_abort_at_body_byte: None,
    });
}

#[test]
fn crash_matrix_pre_data_cmd_recovers_delivery_unknown() {
    run_killpoint_case(&KillpointExpectation {
        killpoint: "post_data_started_pre_data_cmd",
        stage: "send",
        recovery_outcome: Some("delivery_unknown"),
        already_terminal: None,
        data_started: true,
        sink_abort_at_body_byte: None,
    });
}

#[test]
fn crash_matrix_post_354_pre_body_recovers_delivery_unknown() {
    // Death after the server's 354 but before the first body byte — the
    // pre-body edge of the DATA window.
    run_killpoint_case(&KillpointExpectation {
        killpoint: "post_data_354_pre_body",
        stage: "send",
        recovery_outcome: Some("delivery_unknown"),
        already_terminal: None,
        data_started: true,
        sink_abort_at_body_byte: None,
    });
}

#[test]
fn crash_matrix_mid_data_body_recovers_delivery_unknown() {
    // The HONEST mid-DATA death (review #17): the sink kills the process
    // only after real body bytes are on the wire, while the client is inside
    // connection.message(). Recovery must classify delivery_unknown — the
    // partial body is never retransmitted.
    run_killpoint_case(&KillpointExpectation {
        killpoint: "mid_data_body",
        stage: "send",
        recovery_outcome: Some("delivery_unknown"),
        already_terminal: None,
        data_started: true,
        sink_abort_at_body_byte: Some(16),
    });
}

#[test]
fn crash_matrix_post_2xx_pre_journal_recovers_delivery_unknown() {
    // The provider said 250, but the crash beat the journal write: nothing
    // persisted ⇒ delivery_unknown (never retransmit; the 250 is honored by
    // the tombstone, not by a duplicate send).
    run_killpoint_case(&KillpointExpectation {
        killpoint: "post_2xx_pre_journal",
        stage: "send",
        recovery_outcome: Some("delivery_unknown"),
        already_terminal: None,
        data_started: true,
        sink_abort_at_body_byte: None,
    });
}

#[test]
fn crash_matrix_post_data_completed_journal_recovers_submitted() {
    // The 250 WAS journaled (data_completed + response persisted) before the
    // crash ⇒ recovery finishes as terminal submitted (terminal-if-persisted).
    run_killpoint_case(&KillpointExpectation {
        killpoint: "post_data_completed_journal",
        stage: "send",
        recovery_outcome: Some("submitted"),
        already_terminal: None,
        data_started: true,
        sink_abort_at_body_byte: None,
    });
}

#[test]
fn crash_matrix_post_journal_pre_report_keeps_terminal() {
    // journal_terminal committed before the report: reopen sees the terminal
    // + tombstone + a pending settled event awaiting outbox handoff.
    run_killpoint_case(&KillpointExpectation {
        killpoint: "post_journal_pre_report",
        stage: "send",
        recovery_outcome: None,
        already_terminal: Some("submitted"),
        data_started: true,
        sink_abort_at_body_byte: None,
    });
    // (pending-event re-handoff is exercised in
    // pending_events_rehandoff_after_crash below.)
}

#[test]
fn pending_events_rehandoff_after_crash() {
    let dir = temp_dir("pending");
    let mut journal = open_journal(&dir);
    journal
        .record_send_command("job-p", 1, "cmd-p", "bind-1", "hash-p", "test", |_| json!({"p": 1}))
        .unwrap();
    let event = PendingEventRow {
        status_event_id: "evt-p".to_string(),
        send_job_id: "job-p".to_string(),
        generation: 1,
        payload: json!({"phase": "settled", "status_event_id": "evt-p"}),
    };
    journal
        .journal_terminal("job-p", 1, "submitted", &event)
        .unwrap();
    // Two pending events: the intake-journaled `received` (review #4) and
    // the settled terminal.
    let pending = journal.pending_events().unwrap();
    assert_eq!(pending.len(), 2);
    assert!(pending
        .iter()
        .any(|entry| entry.status_event_id == "evt-p"));
    // Handoff + cloud ack drains the settled event from the pending queue.
    journal.mark_event_handed_off("evt-p").unwrap();
    assert!(
        journal
            .pending_events()
            .unwrap()
            .iter()
            .any(|entry| entry.status_event_id == "evt-p"),
        "handed_off still pending ack"
    );
    journal.record_cloud_ack("evt-p", true, None).unwrap();
    assert!(!journal
        .pending_events()
        .unwrap()
        .iter()
        .any(|entry| entry.status_event_id == "evt-p"));
}

// =====================================================================
// Fixture corpus shape tests (§9/§10)
// =====================================================================

fn fixture(dir: &std::path::Path, name: &str) -> Value {
    serde_json::from_str(
        &std::fs::read_to_string(dir.join(name))
            .unwrap_or_else(|error| panic!("fixture {name} unreadable: {error}")),
    )
    .unwrap_or_else(|error| panic!("fixture {name} unparsable: {error}"))
}

#[test]
fn fixtures_wake_commands_parse_with_exact_fields() {
    let Some(dir) = super::test_fixtures_dir() else {
        eprintln!("email-v1 fixtures unavailable; skipping");
        return;
    };
    let send = fixture(&dir, "wake_command__email_send__exact.json");
    let payload = &send["payload"];
    let command = contract::parse_email_command(contract::EMAIL_COMMAND_SEND, payload).unwrap();
    if let contract::EmailCommand::Send {
        command_id,
        send_job_id,
        generation,
        ..
    } = &command
    {
        assert_eq!(
            command_id,
            &contract::email_send_command_id(send_job_id, *generation),
            "deterministic command id shape (§1)"
        );
    } else {
        panic!("expected send command");
    }
    // §9.4: exactly these fields and nothing else.
    let keys: std::collections::BTreeSet<&str> = payload
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    let expected: std::collections::BTreeSet<&str> = [
        "contract",
        "schema_version",
        "command_id",
        "command_kind",
        "send_job_id",
        "generation",
        "binding_id",
        "target_device_id",
    ]
    .into_iter()
    .collect();
    assert_eq!(keys, expected, "wake command payload is exact");

    let probe = fixture(&dir, "wake_command__email_credential_probe__exact.json");
    assert!(contract::parse_email_command(
        contract::EMAIL_COMMAND_CREDENTIAL_PROBE,
        &probe["payload"]
    )
    .is_ok());
    let preflight = fixture(&dir, "wake_command__email_preflight_run__exact.json");
    let parsed =
        contract::parse_email_command(contract::EMAIL_COMMAND_PREFLIGHT_RUN, &preflight["payload"])
            .unwrap();
    if let contract::EmailCommand::PreflightRun {
        requested_checks, ..
    } = parsed
    {
        assert_eq!(
            requested_checks,
            vec!["public_ip", "port25_egress", "ptr_fcrdns"]
        );
        for check in &requested_checks {
            assert!(contract::PREFLIGHT_CHECK_IDS.contains(&check.as_str()));
        }
    } else {
        panic!("expected preflight command");
    }
}

#[test]
fn fixtures_send_events_respect_phase_field_rules() {
    let Some(dir) = super::test_fixtures_dir() else {
        eprintln!("email-v1 fixtures unavailable; skipping");
        return;
    };
    for name in [
        "send_event__email_send_event__received.json",
        "send_event__email_send_event__prepared.json",
        "send_event__email_send_event__progress.json",
        "send_event__email_send_event__data_started.json",
        "send_event__email_send_event__terminal.json",
        "send_event__email_send_event__delivery_unknown.json",
        "send_event__email_send_event__stale_generation.json",
    ] {
        let pair = fixture(&dir, name);
        let event = &pair["payload"]["event"];
        let ack = &pair["payload"]["ack"];
        let phase = SendPhase::parse(event["phase"].as_str().unwrap()).unwrap();
        assert_eq!(
            event["phase_rank"].as_u64().unwrap() as u32,
            phase.rank(),
            "{name}: rank matches ladder"
        );
        assert!(event.get("terminal").is_none(), "{name}: no terminal bool");
        // Per-phase presence rules (§9.2).
        let has = |key: &str| event.get(key).is_some();
        if phase.rank() >= SendPhase::Prepared.rank() {
            assert!(
                has("mode") && has("lease_id") && has("lease_epoch"),
                "{name}"
            );
            contract::u64_from_wire(&event["lease_epoch"]).expect("lease_epoch string");
        } else {
            assert!(
                !has("mode") && !has("lease_id") && !has("lease_epoch"),
                "{name}"
            );
        }
        if phase.rank() >= SendPhase::Verified.rank() {
            assert!(has("mime_sha256") && has("data_started"), "{name}");
        } else {
            assert!(!has("mime_sha256") && !has("data_started"), "{name}");
        }
        if phase == SendPhase::Settled {
            assert!(has("per_recipient") && has("error_class"), "{name}");
            for recipient in event["per_recipient"].as_array().unwrap() {
                assert!(contract::DELIVERY_STATES
                    .contains(&recipient["delivery_state"].as_str().unwrap()));
                if let Some(response) = recipient.get("response") {
                    contract::SanitizedResponse::from_value(response)
                        .unwrap_or_else(|error| panic!("{name}: {error}"));
                }
            }
            assert!(contract::ERROR_CLASSES.contains(&event["error_class"].as_str().unwrap()));
        }
        // Ack shape (§9.3).
        assert_eq!(ack["status_event_id"], event["status_event_id"], "{name}");
        assert!(ack["applied"].is_boolean(), "{name}");
        if let Some(audit) = ack.get("audit") {
            assert!(contract::SETTLEMENT_AUDITS.contains(&audit.as_str().unwrap()));
            // The stale-generation shape: SUCCESS ack, applied false.
            if audit == "stale_generation" {
                assert_eq!(ack["applied"], false);
            }
        }
    }
}

#[test]
fn fixtures_journal_rows_match_table_columns() {
    let Some(dir) = super::test_fixtures_dir() else {
        eprintln!("email-v1 fixtures unavailable; skipping");
        return;
    };
    let journal_dir = temp_dir("fixture-columns");
    let journal = open_journal(&journal_dir);
    // Map fixture columns that are represented differently locally.
    let column_aliases: std::collections::BTreeMap<&str, &str> = [
        ("mime_sha256", "mime_sha256"),
        ("mime_size_bytes", "mime_size_bytes"),
    ]
    .into_iter()
    .collect();
    for entry in std::fs::read_dir(&dir).unwrap() {
        let path = entry.unwrap().path();
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        if !name.starts_with("journal__") {
            continue;
        }
        let payload = fixture(&dir, &name);
        let table = payload["payload"]["table"].as_str().unwrap();
        let row = payload["payload"]["row"].as_object().unwrap();
        let mut statement = journal
            .connection()
            .prepare(&format!("PRAGMA table_info({table})"))
            .unwrap_or_else(|error| panic!("{name}: table {table} missing: {error}"));
        let columns: std::collections::BTreeSet<String> = statement
            .query_map([], |table_row| table_row.get::<_, String>(1))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert!(!columns.is_empty(), "{name}: table {table} must exist");
        for key in row.keys() {
            let mapped = column_aliases.get(key.as_str()).copied().unwrap_or(key);
            // The lease_epoch fixture stores a native number; observation
            // rows use an autoincrement id locally. Everything the corpus
            // names must exist as a column.
            assert!(
                columns.contains(mapped),
                "{name}: fixture column {key} missing from {table} ({columns:?})"
            );
        }
    }
}

#[test]
fn fixtures_preflight_results_validate() {
    let Some(dir) = super::test_fixtures_dir() else {
        eprintln!("email-v1 fixtures unavailable; skipping");
        return;
    };
    for name in [
        "preflight__result__qualified.json",
        "preflight__result__failed_cgnat.json",
        "preflight__result__pending_first_observation.json",
    ] {
        let wire = fixture(&dir, name);
        let payload = &wire["payload"];
        assert_eq!(payload["contract"], contract::EMAIL_CONTRACT, "{name}");
        assert!(contract::PREFLIGHT_RESULTS.contains(&payload["result"].as_str().unwrap()));
        let checks = payload["checks"].as_array().unwrap();
        for check in checks {
            assert!(
                contract::PREFLIGHT_CHECK_IDS.contains(&check["check_id"].as_str().unwrap()),
                "{name}: closed check id"
            );
            assert!(contract::PREFLIGHT_CHECK_STATUSES.contains(&check["status"].as_str().unwrap()));
        }
        // 24h expiry shape.
        let ran = payload["ran_at_ms"].as_i64().unwrap();
        let expires = payload["expires_at_ms"].as_i64().unwrap();
        assert!(expires > ran, "{name}");
        // CGNAT fixture: our own classifier agrees the ip is not public.
        if name.contains("cgnat") {
            let ip: std::net::IpAddr = payload["egress_ip"].as_str().unwrap().parse().unwrap();
            assert!(!super::preflight::is_public_routable(ip));
            assert_eq!(payload["result"], "failed");
        }
    }
}

#[test]
fn fixtures_generation_retired_and_refusals() {
    let Some(dir) = super::test_fixtures_dir() else {
        eprintln!("email-v1 fixtures unavailable; skipping");
        return;
    };
    let retired = fixture(&dir, "generation_retired__ack__basic.json");
    let parsed = super::remote::parse_generation_retired(&retired["payload"]).unwrap();
    assert_eq!(parsed.0, "019f9382-9904-7def-9012-435465768798");
    assert_eq!(parsed.1, 1);

    let registry = fixture(&dir, "refusals__slug_registry__closed.json");
    let slugs: Vec<&str> = registry["payload"]["refusal_slugs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|slug| slug.as_str().unwrap())
        .collect();
    assert_eq!(slugs.len(), contract::REFUSAL_SLUGS.len());
    for slug in slugs {
        assert!(contract::is_known_refusal_slug(slug), "{slug}");
    }
}

#[test]
fn fixtures_u64_string_rule() {
    let Some(dir) = super::test_fixtures_dir() else {
        eprintln!("email-v1 fixtures unavailable; skipping");
        return;
    };
    let valid = fixture(&dir, "u64__string__valid.json");
    let payload = &valid["payload"];
    assert_eq!(
        contract::u64_from_wire(&payload["email_mutation_seq"]).unwrap(),
        u64::MAX
    );
    assert_eq!(contract::u64_from_wire(&payload["lease_epoch"]).unwrap(), 7);
    // Bounded u32s stay JSON numbers.
    assert!(payload["generation"].is_u64());
    assert!(payload["phase_rank"].is_u64());
    assert!(payload["size_bytes"].is_u64());

    let rejected = fixture(&dir, "u64__string__number_rejected.json");
    assert!(rejected["expect"].as_str().unwrap().starts_with("reject:"));
    assert!(contract::u64_from_wire(&rejected["payload"]["email_mutation_seq"]).is_err());
}

#[test]
fn fixtures_capabilities_and_resume_shapes() {
    let Some(dir) = super::test_fixtures_dir() else {
        eprintln!("email-v1 fixtures unavailable; skipping");
        return;
    };
    let capabilities = fixture(&dir, "requests__email_sender_capabilities_sync__happy.json");
    let request = &capabilities["payload"]["request"];
    for key in [
        "capability_version",
        "modes",
        "profiles",
        "runtime",
        "credential_store",
    ] {
        assert!(request.get(key).is_some(), "capabilities request has {key}");
    }
    let result = &capabilities["payload"]["response"]["data"]["result"];
    contract::u64_from_wire(&result["accepted_revision"]).unwrap();
    assert!(result["bindings"].is_array());
    // Bindings parse into the cache and resolve profile_ref by binding_id.
    let journal_dir = temp_dir("bindings-fixture");
    let mut journal = open_journal(&journal_dir);
    profiles::store_bindings_cache(&mut journal, &result["bindings"]).unwrap();
    let binding_id = result["bindings"][0]["binding_id"].as_str().unwrap();
    assert_eq!(
        profiles::binding_profile_ref(&journal, binding_id)
            .unwrap()
            .as_deref(),
        result["bindings"][0]["profile_ref"].as_str()
    );

    let resume = fixture(&dir, "requests__email_send_resume__happy.json");
    let reoffers = resume["payload"]["response"]["data"]["reoffers"]
        .as_array()
        .unwrap();
    for reoffer in reoffers {
        // Reoffers are full §9.4 wake commands — the SAME parser applies.
        assert!(super::remote::event_email_command(reoffer).is_some());
    }
    for summary in resume["payload"]["request"]["journal_summaries"]
        .as_array()
        .unwrap()
    {
        SendPhase::parse(summary["phase"].as_str().unwrap()).unwrap();
        contract::u64_from_wire(&summary["lease_epoch"]).unwrap();
    }
    let unknown = fixture(&dir, "requests__email_send_resume__unknown_phase.json");
    // Fail-closed: the corpus's unknown-phase variant must not parse.
    let mut saw_unknown = false;
    if let Some(summaries) = unknown["payload"]["request"]["journal_summaries"].as_array() {
        for summary in summaries {
            if let Some(phase) = summary["phase"].as_str() {
                if SendPhase::parse(phase).is_err() {
                    saw_unknown = true;
                }
            }
        }
    }
    assert!(
        saw_unknown
            || unknown["expect"]
                .as_str()
                .unwrap_or("")
                .starts_with("reject:"),
        "unknown-phase fixture must fail closed"
    );
}

// =====================================================================
// Intake wiring guards (both paths, ahead of the generic ack)
// =====================================================================

#[test]
fn intake_wiring_special_cases_email_ahead_of_generic_ack_in_both_paths() {
    let source = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/cloud_mcp.rs"),
    )
    .expect("cloud_mcp.rs readable");

    // Live intake: the email hook sits between the device-match check and
    // the receipt claim / generic "received" ack.
    let live_start = source
        .find("if event_kind != \"remote_command_requested\" {\n                continue;")
        .expect("live listener present");
    let live = &source[live_start..live_start + 20_000];
    let hook = live
        .find("email_try_handle_remote_command")
        .expect("live path email hook");
    let claim = live
        .find("cloud_mcp_claim_remote_command_receipt_for_dispatcher")
        .expect("live receipt claim");
    let generic_ack = live
        .find("\"Remote command received by desktop.\"")
        .expect("live generic ack");
    assert!(hook < claim, "email hook must run before the receipt claim");
    assert!(
        hook < generic_ack,
        "email hook must run before the generic ack"
    );

    // Replay path: same ordering inside the resume-replay function.
    let replay_start = source
        .find("async fn cloud_mcp_apply_account_sync_resume_remote_commands")
        .expect("replay fn present");
    let replay = &source[replay_start..replay_start + 20_000];
    let hook = replay
        .find("email_try_handle_remote_command")
        .expect("replay path email hook");
    let claim = replay
        .find("cloud_mcp_claim_remote_command_receipt_for_dispatcher")
        .expect("replay receipt claim");
    let generic_ack = replay
        .find("\"Remote command received by desktop.\"")
        .expect("replay generic ack");
    assert!(hook < claim, "replay email hook before the receipt claim");
    assert!(
        hook < generic_ack,
        "replay email hook before the generic ack"
    );

    // Dispatcher matcher owns the email kinds (webview never handles them).
    let matcher_start = source
        .find("fn cloud_mcp_remote_command_is_rust_owned_for_dispatcher")
        .expect("matcher present");
    let matcher = &source[matcher_start..matcher_start + 4_000];
    for kind in [
        "\"email_send\"",
        "\"email_credential_probe\"",
        "\"email_preflight_run\"",
    ] {
        assert!(matcher.contains(kind), "matcher owns {kind}");
    }
}

#[test]
fn intake_ack_replay_carries_original_event_id_across_paths() {
    // The same command journaled via "live_intake" then replayed via
    // "account_sync_resume_replay" must produce accepted-then-duplicate with
    // a stable first_status_event_id — the §9.4 dedup across BOTH paths.
    let dir = temp_dir("both-paths");
    let mut journal = open_journal(&dir);
    let command = contract::parse_email_command(
        contract::EMAIL_COMMAND_SEND,
        &json!({
            "command_id": "email-send:job-bp:1",
            "send_job_id": "job-bp",
            "generation": 1,
            "binding_id": "bind-1",
            "target_device_id": "device-test",
        }),
    )
    .unwrap();
    let live =
        journal_command_before_ack(&mut journal, &command, "live_intake", "device-test").unwrap();
    assert_eq!(live.result, "accepted");
    let replay =
        journal_command_before_ack(
        &mut journal,
        &command,
        "account_sync_resume_replay",
        "device-test",
    )
    .unwrap();
    assert_eq!(replay.result, "duplicate");
    assert_eq!(replay.first_status_event_id, live.first_status_event_id);
    let ack_payload = super::remote::email_intake_ack_payload(
        &command,
        &IntakeAck::duplicate(replay.first_status_event_id.clone()),
        "device-test",
        "device-test",
    );
    assert_eq!(ack_payload["status"], "duplicate");
    assert_eq!(
        ack_payload["first_status_event_id"],
        json!(live.first_status_event_id.unwrap())
    );
}

// =====================================================================
// Review-round regressions: the DATA boundary crosses at most once (#1),
// duplicate settles re-hand the original event (#7), compaction never
// weakens the generation fence (#5), identity beats tombstone dominance
// (#6), full-range lease epochs fence correctly (#10), configured
// credentials that cannot resolve stop before SMTP (#13), and leased
// native jobs execute end-to-end (#11).
// =====================================================================

#[test]
fn data_started_job_never_reenters_smtp() {
    // Review #1 (CRITICAL): a duplicate wake for a pair that already crossed
    // DATA terminalizes it BEFORE prepare — the transport's prepare must
    // never be called and no SMTP session may open.
    let dir = temp_dir("data-guard");
    let mut journal = open_journal(&dir);
    let memory = MemoryCredentialStore::new();
    let (send_job_id, generation) = seed_send_job(&mut journal, &memory, 2525);
    journal
        .replace_recipients(
            &send_job_id,
            generation,
            &[RecipientRow {
                recipient_ref: "r1".to_string(),
                role: "to".to_string(),
                address: "billing@partner.example".to_string(),
                domain: "partner.example".to_string(),
                status: "pending".to_string(),
                smtp_code: None,
                enhanced_code: None,
                response_class: None,
                response_sanitized: None,
                retry_at_ms: None,
            }],
        )
        .unwrap();
    journal.mark_data_started(&send_job_id, generation).unwrap();

    let transport = FakeCloudTransport::new(); // nothing scripted on purpose
    let result = run_send_job(
        &deps(&transport, &memory),
        &mut journal,
        &send_job_id,
        generation,
    )
    .unwrap();
    assert_eq!(
        result,
        SubmissionResult::Terminal("delivery_unknown".to_string())
    );
    assert_eq!(
        *transport.prepare_calls.lock().unwrap(),
        0,
        "prepare must never run for a data_started pair"
    );
    assert!(journal.tombstone(&send_job_id, generation).unwrap().is_some());
    // The settled event was journaled and handed off.
    assert!(transport
        .event_phases()
        .contains(&"settled".to_string()));
    // A second duplicate run is refused outright.
    let rerun = run_send_job(
        &deps(&transport, &memory),
        &mut journal,
        &send_job_id,
        generation,
    )
    .unwrap();
    assert!(matches!(rerun, SubmissionResult::NotRunnable(_)));
}

#[test]
fn restart_recovery_settles_before_any_intake_can_rerun() {
    // Review #1: startup recovery is synchronous and runs before intake —
    // after it, a redelivered wake dedupes and the worker refuses the pair.
    let dir = temp_dir("restart-guard");
    let mut journal = open_journal(&dir);
    let memory = MemoryCredentialStore::new();
    let (send_job_id, generation) = seed_send_job(&mut journal, &memory, 2525);
    journal.mark_data_started(&send_job_id, generation).unwrap();

    // "Restart": recovery classifies the crashed pair first.
    let settled = journal.recover_after_restart("device-test").unwrap();
    assert!(settled
        .iter()
        .any(|(job, _, outcome)| job == &send_job_id && outcome == "delivery_unknown"));

    // The duplicate wake then dedupes (tombstone/receipt) …
    let command = contract::parse_email_command(
        contract::EMAIL_COMMAND_SEND,
        &json!({
            "command_id": contract::email_send_command_id(&send_job_id, generation),
            "send_job_id": send_job_id,
            "generation": generation,
            "binding_id": "bind-1",
            "target_device_id": "device-test",
        }),
    )
    .unwrap();
    let ack = journal_command_before_ack(&mut journal, &command, "live_intake", "device-test")
        .unwrap();
    assert_eq!(ack.result, "duplicate");
    // … and the worker path refuses to run it.
    let transport = FakeCloudTransport::new();
    let result = run_send_job(
        &deps(&transport, &memory),
        &mut journal,
        &send_job_id,
        generation,
    )
    .unwrap();
    assert!(matches!(result, SubmissionResult::NotRunnable(_)));
    assert_eq!(*transport.prepare_calls.lock().unwrap(), 0);
}

#[test]
fn send_worker_claim_is_exclusive_per_pair() {
    // Review #1: at most one send worker per (send_job_id, generation) per
    // process — the duplicate spawn exits instead of racing SMTP.
    let claim = super::remote::claim_send_worker("job-claim", 1).expect("first claim");
    assert!(
        super::remote::claim_send_worker("job-claim", 1).is_none(),
        "second concurrent claim must be refused"
    );
    // A different generation is independent.
    let other = super::remote::claim_send_worker("job-claim", 2).expect("other generation");
    drop(other);
    drop(claim);
    // Release re-enables the pair.
    assert!(super::remote::claim_send_worker("job-claim", 1).is_some());
}

#[test]
fn duplicate_settle_rehands_original_event_never_a_new_one() {
    // Review #7: journal_terminal inserts the settled event exactly once;
    // the losing settle attempt must re-hand THAT event, never its own.
    let dir = temp_dir("settle-race");
    let mut journal = open_journal(&dir);
    journal
        .record_send_command(
            "job-race",
            1,
            "cmd-race",
            "bind-1",
            "hash-race",
            "test",
            |_| json!({"p": 1}),
        )
        .unwrap();
    let first = PendingEventRow {
        status_event_id: "evt-first".to_string(),
        send_job_id: "job-race".to_string(),
        generation: 1,
        payload: json!({"phase": "settled", "status_event_id": "evt-first"}),
    };
    assert!(journal
        .journal_terminal("job-race", 1, "submitted", &first)
        .unwrap());
    // The losing writer's proposal is NOT inserted…
    let second = PendingEventRow {
        status_event_id: "evt-second".to_string(),
        send_job_id: "job-race".to_string(),
        generation: 1,
        payload: json!({"phase": "settled", "status_event_id": "evt-second"}),
    };
    assert!(!journal
        .journal_terminal("job-race", 1, "delivery_unknown", &second)
        .unwrap());
    // …and the pair's journaled settled event is still the ORIGINAL.
    let (original, outbox_state) = journal
        .load_settled_event("job-race", 1)
        .unwrap()
        .expect("settled event exists");
    assert_eq!(original.status_event_id, "evt-first");
    assert_eq!(outbox_state, "pending");
    let count: i64 = journal
        .connection()
        .query_row(
            "SELECT COUNT(1) FROM email_send_events
             WHERE send_job_id = 'job-race' AND phase = 'settled'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 1, "exactly one settled event per pair");
    // The terminal outcome stays the winner's.
    let job = journal.load_job("job-race", 1).unwrap().unwrap();
    assert_eq!(job.terminal_outcome.as_deref(), Some("submitted"));
}

#[test]
fn compacted_generation_still_fences_lower_generations() {
    // Review #5: compaction deletes the job row but the tombstone must keep
    // the generation high-water — a first-ever lower generation stays fenced.
    let dir = temp_dir("fence-compaction");
    let mut journal = open_journal(&dir);
    journal
        .record_send_command("job-hw", 2, "cmd-hw2", "bind-1", "hash-2", "test", |_| {
            json!({"p": 1})
        })
        .unwrap();
    let event = PendingEventRow {
        status_event_id: "evt-hw".to_string(),
        send_job_id: "job-hw".to_string(),
        generation: 2,
        payload: json!({"phase": "settled"}),
    };
    journal
        .journal_terminal("job-hw", 2, "submitted", &event)
        .unwrap();
    journal.record_cloud_ack("evt-hw", true, None).unwrap();
    // The intake-journaled received event must also be acked for compaction.
    let pending = journal.pending_events_for("job-hw", 2).unwrap();
    for entry in pending {
        journal
            .record_cloud_ack(&entry.status_event_id, true, None)
            .unwrap();
    }
    journal.record_generation_retired("job-hw", 2).unwrap();
    assert_eq!(journal.compact_retired_tombstones().unwrap(), 1);
    assert!(journal.load_job("job-hw", 2).unwrap().is_none());
    // A NEVER-seen generation 1 arrives after compaction: still fenced.
    let intake = journal
        .record_send_command("job-hw", 1, "cmd-hw1", "bind-1", "hash-1", "test", |_| {
            json!({"p": 1})
        })
        .unwrap();
    assert!(
        matches!(
            intake,
            CommandIntake::FencedByHigherGeneration {
                current_generation: 2
            }
        ),
        "tombstoned high-water must fence: {intake:?}"
    );
}

#[test]
fn payload_hash_conflict_beats_tombstone_dominance() {
    // Review #6: a reused command_id with a DIFFERENT payload hash is a
    // security rejection even when the pair is tombstoned — identity wins.
    let dir = temp_dir("hash-vs-tombstone");
    let mut journal = open_journal(&dir);
    journal
        .record_send_command("job-sec", 1, "cmd-sec", "bind-1", "hash-A", "test", |_| {
            json!({"p": 1})
        })
        .unwrap();
    let event = PendingEventRow {
        status_event_id: "evt-sec".to_string(),
        send_job_id: "job-sec".to_string(),
        generation: 1,
        payload: json!({"phase": "settled"}),
    };
    journal
        .journal_terminal("job-sec", 1, "submitted", &event)
        .unwrap();
    // Same command id, tampered payload: SecurityRejected, not Tombstoned.
    let intake = journal
        .record_send_command("job-sec", 1, "cmd-sec", "bind-1", "hash-B", "test", |_| {
            json!({"p": 1})
        })
        .unwrap();
    assert!(
        matches!(intake, CommandIntake::SecurityRejected { .. }),
        "identity check must precede tombstone dominance: {intake:?}"
    );
}

#[test]
fn lease_epoch_full_u64_range_fences_correctly() {
    // Review #10: epochs above i64::MAX (and 2^53) must round-trip
    // losslessly and keep the higher-fences-lower ordering.
    let dir = temp_dir("epoch-range");
    let mut journal = open_journal(&dir);
    journal
        .record_send_command("job-ep", 1, "cmd-ep", "bind-1", "hash-ep", "test", |_| {
            json!({"p": 1})
        })
        .unwrap();
    let above_i64 = (i64::MAX as u64) + 7;
    journal
        .record_lease("job-ep", 1, "provider", "lease-1", above_i64, 1, "sha", 1)
        .unwrap();
    assert_eq!(
        journal.load_job("job-ep", 1).unwrap().unwrap().lease_epoch,
        above_i64,
        "epoch above i64::MAX survives round-trip"
    );
    // A LOWER epoch is fenced.
    assert!(
        journal
            .record_lease("job-ep", 1, "provider", "lease-0", 5, 1, "sha", 1)
            .is_err(),
        "older epoch must be fenced by the newer one"
    );
    // u64::MAX still supersedes.
    journal
        .record_lease("job-ep", 1, "provider", "lease-2", u64::MAX, 1, "sha", 1)
        .unwrap();
    assert!(journal
        .record_lease("job-ep", 1, "provider", "lease-1", above_i64, 1, "sha", 1)
        .is_err());
    // Resume summaries serialize the unsigned decimal (no sign corruption).
    let summaries = journal.resume_summaries().unwrap();
    let entry = summaries
        .iter()
        .find(|entry| entry["send_job_id"] == "job-ep")
        .unwrap();
    assert_eq!(entry["lease_epoch"], json!(u64::MAX.to_string()));
}

#[test]
fn atomic_data_completed_flips_recipients_in_the_same_txn() {
    // Review #8: a persisted provider 2xx can never coexist with `pending`
    // recipient rows — the flip happens in the same transaction.
    let dir = temp_dir("atomic-250");
    let mut journal = open_journal(&dir);
    journal
        .record_send_command("job-a250", 1, "cmd-a250", "bind-1", "hash", "test", |_| {
            json!({"p": 1})
        })
        .unwrap();
    journal
        .replace_recipients(
            "job-a250",
            1,
            &[RecipientRow {
                recipient_ref: "r1".to_string(),
                role: "to".to_string(),
                address: "a@b.example".to_string(),
                domain: "b.example".to_string(),
                status: "pending".to_string(),
                smtp_code: None,
                enhanced_code: None,
                response_class: None,
                response_sanitized: None,
                retry_at_ms: None,
            }],
        )
        .unwrap();
    journal.mark_data_started("job-a250", 1).unwrap();
    journal
        .mark_data_completed("job-a250", 1, Some(250), "accepted", Some("250 ok"))
        .unwrap();
    let rows = journal.load_recipients("job-a250", 1).unwrap();
    assert!(rows
        .iter()
        .all(|row| row.status == "submitted" && row.smtp_code == Some(250)));
    // Monotonic boundary (review #1): data_started can never regress a
    // data_completed job.
    assert!(journal.mark_data_started("job-a250", 1).is_err());
    let job = journal.load_job("job-a250", 1).unwrap().unwrap();
    assert_eq!(job.phase, "data_completed");
}

#[test]
fn configured_credentials_unavailable_stops_before_smtp() {
    // Review #13: a configured locator that no longer resolves must stop the
    // run with a credential failure BEFORE any SMTP traffic.
    let sink = SmtpSink::start(SinkMode::Plain, SinkBehavior::default());
    let dir = temp_dir("cred-unavailable");
    let mut journal = open_journal(&dir);
    let memory = MemoryCredentialStore::new();
    let (send_job_id, generation) = seed_send_job(&mut journal, &memory, sink.port);
    // Point the profile at a locator the store cannot resolve.
    journal
        .connection()
        .execute(
            "UPDATE email_sender_profiles
             SET secret_locator = 'memory://diffforge/email/deleted'
             WHERE profile_ref = 'profile-test'",
            [],
        )
        .unwrap();
    let transport = FakeCloudTransport::new();
    scripted_prepare(&transport, "provider");
    let result = run_send_job(
        &deps(&transport, &memory),
        &mut journal,
        &send_job_id,
        generation,
    )
    .unwrap();
    assert_eq!(
        result,
        SubmissionResult::Abandoned("credential_failure".to_string())
    );
    assert_eq!(
        sink.state().connections,
        0,
        "no SMTP connection without resolvable configured credentials"
    );
    // Non-terminal: the credential_required → re-offer cycle can retry.
    let job = journal.load_job(&send_job_id, generation).unwrap().unwrap();
    assert!(job.terminal_outcome.is_none());
}

// =====================================================================
// Native delivery through the send state machine (review #11)
// =====================================================================

fn seed_native_dkim_key(
    journal: &EmailJournal,
    memory: &MemoryCredentialStore,
    domain: &str,
) -> String {
    let key = crate::email::dkim::generate_rsa_dkim_key().unwrap();
    let locator = memory.set("dkim-test", &key.private_key_pem).unwrap();
    journal
        .connection()
        .execute(
            "INSERT OR REPLACE INTO email_dkim_keys
             (domain, selector, state, pubkey_fingerprint_sha256, public_key_b64,
              secret_locator, created_at_ms)
             VALUES (?1, 'dfmail1', 'active', ?2, ?3, ?4, 1)",
            rusqlite::params![
                domain,
                key.pubkey_fingerprint_sha256,
                key.public_key_b64,
                locator
            ],
        )
        .unwrap();
    key.pubkey_fingerprint_sha256
}

/// Seed the FULL fail-closed evidence set a native run requires (review
/// R2-2): a fresh egress observation with positive port-25 evidence.
fn seed_native_evidence(journal: &EmailJournal) {
    crate::email::preflight::record_egress_observation(
        journal,
        "198.51.100.7",
        Some(true),
        "test",
    )
    .unwrap();
}

#[test]
fn native_leased_job_executes_end_to_end() {
    use crate::email::mx::{FakeMxResolver, MxResolution, MxTarget};

    let sink = SmtpSink::start(SinkMode::Plain, SinkBehavior::default());
    let dir = temp_dir("native-e2e");
    let mut journal = open_journal(&dir);
    let memory = MemoryCredentialStore::new();
    let (send_job_id, generation) = seed_send_job(&mut journal, &memory, sink.port);
    let fingerprint = seed_native_dkim_key(&journal, &memory, "acme.example");
    seed_native_evidence(&journal);

    let transport = FakeCloudTransport::new();
    transport.put_mime("mime://job", TEST_MIME.to_vec());
    let mut grant = leased_grant_for(
        "mime://job",
        TEST_MIME,
        "bounce@acme.example",
        "ops@acme.example",
        &[("to", "billing@partner.example")],
        "native",
    );
    if let PrepareOutcome::Leased(inner) = &mut grant {
        inner.native.as_mut().unwrap().dkim_pubkey_fingerprint = fingerprint;
    }
    transport.script_prepare(Ok(grant));

    let mx = FakeMxResolver::new();
    mx.set(
        "partner.example",
        MxResolution::Targets(vec![MxTarget {
            host: "localhost".to_string(),
            priority: 10,
        }]),
    );
    let mut submission_deps = deps(&transport, &memory);
    submission_deps.native_mx = Some(&mx);
    submission_deps.native_port_override = Some(sink.port);

    let result = run_send_job(&submission_deps, &mut journal, &send_job_id, generation).unwrap();
    assert_eq!(result, SubmissionResult::Terminal("submitted".to_string()));

    // The sink received exactly one TLS-protected, DKIM-signed message.
    let state = sink.state();
    assert_eq!(state.messages.len(), 1);
    assert!(state.messages[0].tls_active);
    let body = String::from_utf8_lossy(&state.messages[0].data);
    assert!(body.contains("DKIM-Signature"), "native mail is DKIM-signed");

    // Journal: terminal + tombstone + per-recipient submitted + boundary.
    let job = journal.load_job(&send_job_id, generation).unwrap().unwrap();
    assert_eq!(job.terminal_outcome.as_deref(), Some("submitted"));
    assert!(job.data_started);
    assert!(journal.tombstone(&send_job_id, generation).unwrap().is_some());
    let rows = journal.load_recipients(&send_job_id, generation).unwrap();
    assert!(rows.iter().all(|row| row.status == "submitted"));
    // The settled event reports per-recipient submitted, §9.6-sanitized.
    let settled = transport
        .events()
        .into_iter()
        .find(|event| event["phase"] == "settled")
        .unwrap();
    assert_eq!(settled["per_recipient"][0]["delivery_state"], "submitted");
    assert_eq!(settled["error_class"], "none");
    // Re-running the settled pair is refused — tombstone dominates.
    let rerun = run_send_job(&submission_deps, &mut journal, &send_job_id, generation).unwrap();
    assert!(matches!(rerun, SubmissionResult::NotRunnable(_)));
}

#[test]
fn native_without_matching_dkim_key_abandons_without_wire_traffic() {
    use crate::email::mx::{FakeMxResolver, MxResolution, MxTarget};

    let sink = SmtpSink::start(SinkMode::Plain, SinkBehavior::default());
    let dir = temp_dir("native-nokey");
    let mut journal = open_journal(&dir);
    let memory = MemoryCredentialStore::new();
    let (send_job_id, generation) = seed_send_job(&mut journal, &memory, sink.port);
    // NO active DKIM key journaled.

    let transport = FakeCloudTransport::new();
    scripted_prepare(&transport, "native");
    let mx = FakeMxResolver::new();
    mx.set(
        "partner.example",
        MxResolution::Targets(vec![MxTarget {
            host: "localhost".to_string(),
            priority: 10,
        }]),
    );
    let mut submission_deps = deps(&transport, &memory);
    submission_deps.native_mx = Some(&mx);
    submission_deps.native_port_override = Some(sink.port);

    let result = run_send_job(&submission_deps, &mut journal, &send_job_id, generation).unwrap();
    assert_eq!(
        result,
        SubmissionResult::Abandoned("dkim_key_unavailable".to_string())
    );
    assert_eq!(sink.state().messages.len(), 0, "nothing on the wire");
    // Non-terminal: re-offer after the key is provisioned re-executes.
    let job = journal.load_job(&send_job_id, generation).unwrap().unwrap();
    assert!(job.terminal_outcome.is_none());
    assert!(!job.data_started);
}

#[test]
fn vendored_corpus_matches_pinned_lock() {
    // Review #16: the vendored corpus is pinned by email-v1.lock — sha256
    // over, per .json file sorted by name: `name\n` + `hex(sha256(bytes))\n`.
    use sha2::{Digest, Sha256};
    let base = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/contracts/email-v1");
    if !base.is_dir() {
        if std::env::var("EMAIL_V1_REQUIRE_FIXTURES").as_deref() == Ok("1") {
            panic!("vendored corpus missing at {}", base.display());
        }
        eprintln!("vendored corpus absent; skipping lock verification");
        return;
    }
    let mut names: Vec<String> = std::fs::read_dir(&base)
        .unwrap()
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_with(".json"))
        .collect();
    names.sort();
    assert!(names.len() >= 140, "corpus unexpectedly small: {}", names.len());
    let mut outer = Sha256::new();
    for name in &names {
        let bytes = std::fs::read(base.join(name)).unwrap();
        let inner: String = Sha256::digest(&bytes)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        outer.update(name.as_bytes());
        outer.update(b"\n");
        outer.update(inner.as_bytes());
        outer.update(b"\n");
    }
    let computed: String = outer
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let lock = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/contracts/email-v1.lock"),
    )
    .expect("email-v1.lock present");
    let pinned = lock.split_whitespace().next().unwrap_or("");
    assert_eq!(computed, pinned, "vendored corpus drifted from its lock");
}

// =====================================================================
// Round-2 regressions: settlement acks keep the durable retry alive on
// failure (R2-1), fresh fail-closed native fact rechecks (R2-2),
// per-recipient DATA durability + terminal aggregation (R2-3), permanent
// bounces never retried on the same generation (R2-4), durable
// qualification history (R2-6), and UUIDv7 contract ids (R2-9).
// =====================================================================

#[test]
fn settlement_ack_failures_never_ack_the_journal_event() {
    use super::remote::email_apply_send_event_cloud_ack;
    let dir = temp_dir("ack-r2");
    let mut journal = open_journal(&dir);
    journal
        .record_send_command("job-ak", 1, "cmd-ak", "bind-1", "hash-ak", "test", |_| {
            json!({"p": 1})
        })
        .unwrap();
    let event = PendingEventRow {
        status_event_id: "evt-ak".to_string(),
        send_job_id: "job-ak".to_string(),
        generation: 1,
        payload: json!({"phase": "settled", "status_event_id": "evt-ak"}),
    };
    journal
        .journal_terminal("job-ak", 1, "submitted", &event)
        .unwrap();
    let outbox_payload = json!({"status_event_id": "evt-ak"});
    let still_unacked = |journal: &EmailJournal| {
        journal
            .pending_events()
            .unwrap()
            .iter()
            .any(|entry| entry.status_event_id == "evt-ak")
    };

    // Malformed (a generic ok:true shape) — Err, event stays unacked.
    assert!(
        email_apply_send_event_cloud_ack(&mut journal, &outbox_payload, &json!({"ok": true}))
            .is_err()
    );
    assert!(still_unacked(&journal));
    // Mismatched status_event_id — Err, event stays unacked.
    let mismatched = json!({
        "contract": contract::EMAIL_CONTRACT,
        "schema_version": 1,
        "status_event_id": "evt-OTHER",
        "applied": true,
    });
    assert!(email_apply_send_event_cloud_ack(&mut journal, &outbox_payload, &mismatched).is_err());
    assert!(still_unacked(&journal));
    // Payload without a status_event_id — Err.
    assert!(
        email_apply_send_event_cloud_ack(&mut journal, &json!({}), &json!({"applied": true}))
            .is_err()
    );
    // A valid ack persists and drains the pending queue for the event.
    let valid = json!({
        "contract": contract::EMAIL_CONTRACT,
        "schema_version": 1,
        "status_event_id": "evt-ak",
        "applied": true,
    });
    assert!(email_apply_send_event_cloud_ack(&mut journal, &outbox_payload, &valid).is_ok());
    assert!(!still_unacked(&journal));

    // Journal-write failure surfaces as Err (the outbox row must survive).
    let dir = temp_dir("ack-r2-persist");
    let mut broken = open_journal(&dir);
    broken
        .connection()
        .execute_batch("DROP TABLE email_send_events")
        .unwrap();
    assert!(email_apply_send_event_cloud_ack(&mut broken, &outbox_payload, &valid).is_err());
}

#[test]
fn native_missing_port25_evidence_aborts_before_wire() {
    use crate::email::mx::{FakeMxResolver, MxResolution, MxTarget};

    // Review R2-2: NO egress observation exists — the pre-DATA fact recheck
    // fails CLOSED (port25 evidence missing) before anything reaches the
    // wire; nothing defaults to true.
    let sink = SmtpSink::start(SinkMode::Plain, SinkBehavior::default());
    let dir = temp_dir("native-no-evidence");
    let mut journal = open_journal(&dir);
    let memory = MemoryCredentialStore::new();
    let (send_job_id, generation) = seed_send_job(&mut journal, &memory, sink.port);
    let fingerprint = seed_native_dkim_key(&journal, &memory, "acme.example");

    let transport = FakeCloudTransport::new();
    transport.put_mime("mime://job", TEST_MIME.to_vec());
    let mut grant = leased_grant_for(
        "mime://job",
        TEST_MIME,
        "bounce@acme.example",
        "ops@acme.example",
        &[("to", "billing@partner.example")],
        "native",
    );
    if let PrepareOutcome::Leased(inner) = &mut grant {
        inner.native.as_mut().unwrap().dkim_pubkey_fingerprint = fingerprint;
    }
    transport.script_prepare(Ok(grant));
    let mx = FakeMxResolver::new();
    mx.set(
        "partner.example",
        MxResolution::Targets(vec![MxTarget {
            host: "localhost".to_string(),
            priority: 10,
        }]),
    );
    let mut submission_deps = deps(&transport, &memory);
    submission_deps.native_mx = Some(&mx);
    submission_deps.native_port_override = Some(sink.port);

    let result = run_send_job(&submission_deps, &mut journal, &send_job_id, generation).unwrap();
    assert_eq!(
        result,
        SubmissionResult::Abandoned("native_preflight_recheck:port25".to_string())
    );
    assert_eq!(sink.state().messages.len(), 0, "nothing on the wire");
    let job = journal.load_job(&send_job_id, generation).unwrap().unwrap();
    assert!(!job.data_started);
    assert!(job.terminal_outcome.is_none(), "non-terminal for requalification");
}

#[test]
fn native_rotated_secret_behind_locator_never_signs() {
    use crate::email::mx::{FakeMxResolver, MxResolution, MxTarget};

    // Review R2-2: the journal row's fingerprint claim matches the grant,
    // but the SECRET behind the locator was rotated to a different key. The
    // derived fingerprint comparison must refuse to sign.
    let sink = SmtpSink::start(SinkMode::Plain, SinkBehavior::default());
    let dir = temp_dir("native-rotated-key");
    let mut journal = open_journal(&dir);
    let memory = MemoryCredentialStore::new();
    let (send_job_id, generation) = seed_send_job(&mut journal, &memory, sink.port);
    let fingerprint = seed_native_dkim_key(&journal, &memory, "acme.example");
    seed_native_evidence(&journal);
    // Rotate the stored secret out from under the journal row (same
    // locator, different key material).
    let other_key = crate::email::dkim::generate_rsa_dkim_key().unwrap();
    memory.set("dkim-test", &other_key.private_key_pem).unwrap();

    let transport = FakeCloudTransport::new();
    transport.put_mime("mime://job", TEST_MIME.to_vec());
    let mut grant = leased_grant_for(
        "mime://job",
        TEST_MIME,
        "bounce@acme.example",
        "ops@acme.example",
        &[("to", "billing@partner.example")],
        "native",
    );
    if let PrepareOutcome::Leased(inner) = &mut grant {
        inner.native.as_mut().unwrap().dkim_pubkey_fingerprint = fingerprint;
    }
    transport.script_prepare(Ok(grant));
    let mx = FakeMxResolver::new();
    mx.set(
        "partner.example",
        MxResolution::Targets(vec![MxTarget {
            host: "localhost".to_string(),
            priority: 10,
        }]),
    );
    let mut submission_deps = deps(&transport, &memory);
    submission_deps.native_mx = Some(&mx);
    submission_deps.native_port_override = Some(sink.port);

    let result = run_send_job(&submission_deps, &mut journal, &send_job_id, generation).unwrap();
    assert_eq!(
        result,
        SubmissionResult::Abandoned("dkim_key_unavailable".to_string())
    );
    assert_eq!(sink.state().messages.len(), 0, "wrong key must never sign");
}

#[test]
fn native_partial_crash_recovery_keeps_known_recipient_outcomes() {
    // Review R2-3: recipient 1's FULL-durability `submitted` row survives a
    // crash; recovery reports it as submitted — only the unknowable
    // recipient becomes delivery_unknown.
    let dir = temp_dir("native-partial-recovery");
    let mut journal = open_journal(&dir);
    journal
        .record_send_command("job-pr", 1, "cmd-pr", "bind-1", "hash-pr", "test", |_| {
            json!({"p": 1})
        })
        .unwrap();
    let recipient = |suffix: &str| RecipientRow {
        recipient_ref: format!("r{suffix}"),
        role: "to".to_string(),
        address: format!("user{suffix}@partner.example"),
        domain: "partner.example".to_string(),
        status: "pending".to_string(),
        smtp_code: None,
        enhanced_code: None,
        response_class: None,
        response_sanitized: None,
        retry_at_ms: None,
    };
    journal
        .seed_recipients("job-pr", 1, &[recipient("1"), recipient("2")])
        .unwrap();
    journal.mark_data_started("job-pr", 1).unwrap();
    // Recipient 1's 2xx lands FULL-atomically; then the process "dies".
    journal
        .record_recipient_outcome_full(
            "job-pr",
            1,
            "r1",
            "submitted",
            Some(250),
            Some("accepted"),
            None,
            None,
        )
        .unwrap();

    let settled = journal.recover_after_restart("device-test").unwrap();
    assert!(settled
        .iter()
        .any(|(job, _, outcome)| job == "job-pr" && outcome == "delivery_unknown"));
    let (event, _) = journal
        .load_settled_event("job-pr", 1)
        .unwrap()
        .expect("settled event journaled");
    let per_recipient = event.payload["per_recipient"].as_array().unwrap();
    let by_ref = |wanted: &str| {
        per_recipient
            .iter()
            .find(|entry| entry["recipient_ref"] == wanted)
            .unwrap()
    };
    assert_eq!(by_ref("r1")["delivery_state"], "submitted");
    assert_eq!(by_ref("r1")["response"]["smtp_code"], 250);
    assert_eq!(by_ref("r2")["delivery_state"], "delivery_unknown");
}

#[test]
fn native_fence_after_first_recipient_terminalizes_partially_submitted() {
    use super::cloud_transport::RenewOutcome;
    use crate::email::mx::{FakeMxResolver, MxResolution, MxTarget};

    // Review R2-3: a fence abort AFTER recipient 1 crossed DATA must
    // terminalize the pair NOW (partially_submitted), never return a
    // nonterminal Abandoned that strands a data_started job.
    let sink = SmtpSink::start(SinkMode::Plain, SinkBehavior::default());
    let dir = temp_dir("native-fence-partial");
    let mut journal = open_journal(&dir);
    let memory = MemoryCredentialStore::new();
    let (send_job_id, generation) = seed_send_job(&mut journal, &memory, sink.port);
    let fingerprint = seed_native_dkim_key(&journal, &memory, "acme.example");
    seed_native_evidence(&journal);

    let transport = FakeCloudTransport::new();
    transport.put_mime("mime://job2", TEST_MIME_TWO_RCPT.to_vec());
    let mut grant = leased_grant_for(
        "mime://job2",
        TEST_MIME_TWO_RCPT,
        "bounce@acme.example",
        "ops@acme.example",
        &[
            ("to", "billing@partner.example"),
            ("to", "legal@partner.example"),
        ],
        "native",
    );
    if let PrepareOutcome::Leased(inner) = &mut grant {
        inner.native.as_mut().unwrap().dkim_pubkey_fingerprint = fingerprint;
    }
    transport.script_prepare(Ok(grant));
    // Renewals: pre-SMTP ok, recipient-1 pre-DATA ok, recipient-2 fenced.
    transport.script_renew(Ok(RenewOutcome::Extended {
        expires_at_ms: now_plus_two_minutes(),
    }));
    transport.script_renew(Ok(RenewOutcome::Extended {
        expires_at_ms: now_plus_two_minutes(),
    }));
    transport.script_renew(Ok(RenewOutcome::Refused {
        slug: "fenced".to_string(),
        current_lease_epoch: Some(2),
    }));
    let mx = FakeMxResolver::new();
    mx.set(
        "partner.example",
        MxResolution::Targets(vec![MxTarget {
            host: "localhost".to_string(),
            priority: 10,
        }]),
    );
    let mut submission_deps = deps(&transport, &memory);
    submission_deps.native_mx = Some(&mx);
    submission_deps.native_port_override = Some(sink.port);

    let result = run_send_job(&submission_deps, &mut journal, &send_job_id, generation).unwrap();
    assert_eq!(
        result,
        SubmissionResult::Terminal("partially_submitted".to_string())
    );
    // Exactly one message crossed the wire (recipient 1).
    assert_eq!(sink.state().messages.len(), 1);
    let rows = journal.load_recipients(&send_job_id, generation).unwrap();
    let status_of = |wanted: &str| {
        rows.iter()
            .find(|row| row.recipient_ref == wanted)
            .unwrap()
            .status
            .clone()
    };
    assert_eq!(status_of("r1"), "submitted");
    assert_ne!(status_of("r2"), "submitted");
    assert!(journal.tombstone(&send_job_id, generation).unwrap().is_some());
    // The settled event reports both recipients' true states.
    let settled = transport
        .events()
        .into_iter()
        .find(|event| event["phase"] == "settled")
        .unwrap();
    assert_eq!(settled["per_recipient"].as_array().unwrap().len(), 2);
}

#[test]
fn native_permanent_bounce_never_retried_on_same_generation() {
    use crate::email::mx::{FakeMxResolver, MxResolution, MxTarget};

    // Review R2-4: run 1 — r1 bounces permanently (550), r2 greylisted
    // (450). Run 2 — r1 is SKIPPED (never re-RCPTed), r2 delivers; the
    // aggregate includes r1's preserved bounce → partially_submitted.
    let mut rcpt_responses = std::collections::BTreeMap::new();
    rcpt_responses.insert(
        "billing@partner.example".to_string(),
        "550 5.1.1 user unknown".to_string(),
    );
    rcpt_responses.insert(
        "legal@partner.example".to_string(),
        "450 4.7.1 greylisted".to_string(),
    );
    let sink_one = SmtpSink::start(
        SinkMode::Plain,
        SinkBehavior {
            rcpt_responses,
            ..SinkBehavior::default()
        },
    );
    let dir = temp_dir("native-bounce-preserved");
    let mut journal = open_journal(&dir);
    let memory = MemoryCredentialStore::new();
    let (send_job_id, generation) = seed_send_job(&mut journal, &memory, sink_one.port);
    let fingerprint = seed_native_dkim_key(&journal, &memory, "acme.example");
    seed_native_evidence(&journal);

    let scripted_native_grant = |transport: &FakeCloudTransport| {
        transport.put_mime("mime://job2", TEST_MIME_TWO_RCPT.to_vec());
        let mut grant = leased_grant_for(
            "mime://job2",
            TEST_MIME_TWO_RCPT,
            "bounce@acme.example",
            "ops@acme.example",
            &[
                ("to", "billing@partner.example"),
                ("to", "legal@partner.example"),
            ],
            "native",
        );
        if let PrepareOutcome::Leased(inner) = &mut grant {
            inner.native.as_mut().unwrap().dkim_pubkey_fingerprint = fingerprint.clone();
        }
        transport.script_prepare(Ok(grant));
    };
    let mx = FakeMxResolver::new();
    mx.set(
        "partner.example",
        MxResolution::Targets(vec![MxTarget {
            host: "localhost".to_string(),
            priority: 10,
        }]),
    );

    // ---- run 1: bounce + deferral → nonterminal native_deferred ----
    let transport = FakeCloudTransport::new();
    scripted_native_grant(&transport);
    let mut deps_one = deps(&transport, &memory);
    deps_one.native_mx = Some(&mx);
    deps_one.native_port_override = Some(sink_one.port);
    let result = run_send_job(&deps_one, &mut journal, &send_job_id, generation).unwrap();
    assert_eq!(
        result,
        SubmissionResult::Abandoned("native_deferred".to_string())
    );
    let rows = journal.load_recipients(&send_job_id, generation).unwrap();
    let status_of = |rows: &[RecipientRow], wanted: &str| {
        rows.iter()
            .find(|row| row.recipient_ref == wanted)
            .unwrap()
            .status
            .clone()
    };
    assert_eq!(status_of(&rows, "r1"), "bounced");
    assert_eq!(status_of(&rows, "r2"), "deferred");

    // ---- run 2 (re-offer): r1 must NOT be retried; r2 delivers ----
    let sink_two = SmtpSink::start(SinkMode::Plain, SinkBehavior::default());
    let transport = FakeCloudTransport::new();
    scripted_native_grant(&transport);
    let mut deps_two = deps(&transport, &memory);
    deps_two.native_mx = Some(&mx);
    deps_two.native_port_override = Some(sink_two.port);
    let result = run_send_job(&deps_two, &mut journal, &send_job_id, generation).unwrap();
    assert_eq!(
        result,
        SubmissionResult::Terminal("partially_submitted".to_string())
    );
    let state = sink_two.state();
    assert_eq!(state.messages.len(), 1, "only the deferred recipient ran");
    assert_eq!(
        state.messages[0].rcpt_to,
        vec!["legal@partner.example".to_string()],
        "the permanently bounced recipient is never re-RCPTed"
    );
    let rows = journal.load_recipients(&send_job_id, generation).unwrap();
    assert_eq!(status_of(&rows, "r1"), "bounced");
    assert_eq!(
        rows.iter()
            .find(|row| row.recipient_ref == "r1")
            .unwrap()
            .smtp_code,
        Some(550),
        "the preserved bounce keeps its original 550"
    );
    assert_eq!(status_of(&rows, "r2"), "submitted");
    // The settled event carries BOTH prior and new outcomes.
    let settled = transport
        .events()
        .into_iter()
        .find(|event| event["phase"] == "settled")
        .unwrap();
    let per_recipient = settled["per_recipient"].as_array().unwrap();
    assert!(per_recipient
        .iter()
        .any(|entry| entry["recipient_ref"] == "r1" && entry["delivery_state"] == "bounced"));
    assert!(per_recipient
        .iter()
        .any(|entry| entry["recipient_ref"] == "r2" && entry["delivery_state"] == "submitted"));
}

#[test]
fn preflight_qualification_history_survives_expiry() {
    // Review R2-6: previous_qualified is durable HISTORY — an expired
    // qualified run still counts, so a later regression reads degraded.
    let dir = temp_dir("preflight-history");
    let journal = open_journal(&dir);
    journal
        .connection()
        .execute(
            "INSERT INTO email_native_preflight_runs
             (preflight_id, profile_ref, domain, ran_at_ms, expires_at_ms, result,
              qualified, eligible, result_sha256, result_json)
             VALUES ('pf-old', 'profile-test', 'acme.example', 1, 2, 'qualified',
                     1, 0, 'sha', '{}')",
            [],
        )
        .unwrap();
    // expires_at_ms=2 is long past — history must still count.
    assert!(super::remote::preflight_previously_qualified(
        &journal,
        "profile-test",
        "acme.example"
    ));
    assert!(!super::remote::preflight_previously_qualified(
        &journal,
        "profile-test",
        "other.example"
    ));
}

#[test]
fn device_minted_contract_ids_are_uuidv7() {
    // Review R2-9: §1 — device-minted opaque ids are UUIDv7.
    let dir = temp_dir("uuidv7");
    let mut journal = open_journal(&dir);
    let command = contract::parse_email_command(
        contract::EMAIL_COMMAND_SEND,
        &json!({
            "command_id": "email-send:job-v7:1",
            "send_job_id": "job-v7",
            "generation": 1,
            "binding_id": "bind-1",
            "target_device_id": "device-test",
        }),
    )
    .unwrap();
    let ack =
        journal_command_before_ack(&mut journal, &command, "live_intake", "device-test").unwrap();
    let status_event_id = ack.first_status_event_id.unwrap();
    let parsed = uuid::Uuid::parse_str(&status_event_id).unwrap();
    assert_eq!(parsed.get_version_num(), 7, "status_event_id is UUIDv7");
    // Preflight ids too.
    let run = crate::email::preflight::PreflightRun::build(
        "device-test",
        "profile-test",
        "acme.example",
        &crate::email::preflight::PreflightObservations::default(),
        false,
    );
    let parsed = uuid::Uuid::parse_str(&run.preflight_id).unwrap();
    assert_eq!(parsed.get_version_num(), 7, "preflight_id is UUIDv7");
}

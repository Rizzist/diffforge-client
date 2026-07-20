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
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn open_journal(dir: &std::path::Path) -> EmailJournal {
    EmailJournal::open_at(&dir.join("journal.sqlite")).unwrap()
}

const TEST_MIME: &[u8] = b"From: Acme Ops <ops@acme.example>\r\nTo: billing@partner.example\r\nSubject: invoice\r\nDate: Mon, 20 Jul 2026 00:00:00 +0000\r\nMessage-ID: <t1@acme.example>\r\n\r\nhello\r\n";

/// Journal a wake command + seed profile/binding/credentials so run_send_job
/// can go end-to-end against a sink.
fn seed_send_job(
    journal: &mut EmailJournal,
    memory: &MemoryCredentialStore,
    sink_port: u16,
) -> (String, u32) {
    let send_job_id = format!("job-{}", uuid::Uuid::new_v4());
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
    let ack = journal_command_before_ack(journal, &command, "live_intake").unwrap();
    assert_eq!(ack.result, "accepted");

    let locator = memory
        .set(
            "profile-test",
            &secrecy::SecretString::from("app-password"),
        )
        .unwrap();
    journal
        .connection()
        .execute(
            "INSERT INTO email_sender_profiles
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
            .record_send_command(send_job_id, 1, "email-send:job-ts:1", "bind-1", "hash-a", "test")
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
            .record_send_command(send_job_id, 1, "email-send:job-ts:1", "bind-1", "hash-a", "test")
            .unwrap();
        assert!(matches!(intake, CommandIntake::Duplicate { .. } | CommandIntake::Tombstoned { .. }));
        // Ack the settled event as cloud-received, then retire + compact.
        journal.record_cloud_ack("evt-settled", true, None).unwrap();
        assert!(journal.record_generation_retired(send_job_id, 1).unwrap());
        assert_eq!(journal.compact_retired_tombstones().unwrap(), 1);
        // The tombstone ROW itself survives compaction (no time-based
        // deletion, dominance persists); the bulky rows are gone.
        let (_, acked, compacted) = journal.tombstone(send_job_id, 1).unwrap().unwrap();
        assert!(acked);
        assert!(compacted);
        assert!(journal.load_job(send_job_id, 1).unwrap().is_none());
        // Post-compaction redelivery is still refused.
        let intake = journal
            .record_send_command(send_job_id, 1, "email-send:job-ts:1", "bind-1", "hash-a", "test")
            .unwrap();
        assert!(matches!(intake, CommandIntake::Tombstoned { .. } | CommandIntake::Duplicate { .. }));
    }
}

#[test]
fn compaction_waits_for_event_acks_even_after_retirement() {
    let dir = temp_dir("compaction-ack");
    let mut journal = open_journal(&dir);
    journal
        .record_send_command("job-c", 1, "email-send:job-c:1", "bind-1", "hash", "test")
        .unwrap();
    let event = PendingEventRow {
        status_event_id: "evt-c".to_string(),
        send_job_id: "job-c".to_string(),
        generation: 1,
        payload: json!({"phase": "settled"}),
    };
    journal.journal_terminal("job-c", 1, "submitted", &event).unwrap();
    journal.record_generation_retired("job-c", 1).unwrap();
    // The settled event is not cloud-acked yet: compaction must hold.
    assert_eq!(journal.compact_retired_tombstones().unwrap(), 0);
    journal.record_cloud_ack("evt-c", false, Some("stale_generation")).unwrap();
    assert_eq!(journal.compact_retired_tombstones().unwrap(), 1);
}

#[test]
fn phase_ranks_never_regress() {
    let dir = temp_dir("phase");
    let mut journal = open_journal(&dir);
    journal
        .record_send_command("job-p", 1, "cmd", "bind-1", "hash", "test")
        .unwrap();
    assert!(journal.advance_phase("job-p", 1, SendPhase::Downloading).unwrap());
    assert!(!journal.advance_phase("job-p", 1, SendPhase::Prepared).unwrap());
    let job = journal.load_job("job-p", 1).unwrap().unwrap();
    assert_eq!(job.phase, "downloading");
    assert_eq!(job.phase_rank, 4);
}

#[test]
fn cancel_window_closes_at_data_started() {
    let dir = temp_dir("cancel");
    let mut journal = open_journal(&dir);
    journal
        .record_send_command("job-x", 1, "cmd", "bind-1", "hash", "test")
        .unwrap();
    assert!(journal.request_cancel("job-x", 1).unwrap().is_ok());
    // Reset for the second half: new job that reaches data_started.
    journal
        .record_send_command("job-y", 1, "cmd-y", "bind-1", "hash-y", "test")
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
        .record_send_command("job-a", 1, "cmd-a", "bind-1", "hash-a", "test")
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
        .record_send_command("job-b", 1, "cmd-b", "bind-1", "hash-b", "test")
        .unwrap();
    journal.mark_data_started("job-b", 1).unwrap();
    journal
        .mark_data_completed("job-b", 1, Some(250), "accepted")
        .unwrap();
    // Job C: pre-DATA (downloading) → left resumable.
    journal
        .record_send_command("job-c", 1, "cmd-c", "bind-1", "hash-c", "test")
        .unwrap();
    journal.advance_phase("job-c", 1, SendPhase::Downloading).unwrap();

    let settled = journal.recover_after_restart("device-test").unwrap();
    let by_job: std::collections::BTreeMap<String, String> = settled
        .iter()
        .map(|(job, _, outcome)| (job.clone(), outcome.clone()))
        .collect();
    assert_eq!(by_job.get("job-a").map(String::as_str), Some("delivery_unknown"));
    assert_eq!(by_job.get("job-b").map(String::as_str), Some("submitted"));
    assert!(!by_job.contains_key("job-c"), "pre-DATA jobs stay resumable");
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

    let result = run_send_job(&deps(&transport, &memory), &mut journal, &send_job_id, generation)
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
    assert!(journal.tombstone(&send_job_id, generation).unwrap().is_some());

    // Events walked the ladder in rank order and settled exactly once.
    let phases = transport.event_phases();
    let ranks: Vec<u32> = phases
        .iter()
        .map(|phase| SendPhase::parse(phase).unwrap().rank())
        .collect();
    let mut sorted = ranks.clone();
    sorted.sort_unstable();
    assert_eq!(ranks, sorted, "phase events emit in rank order: {phases:?}");
    assert_eq!(
        phases.iter().filter(|phase| *phase == "settled").count(),
        1
    );
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
    let rerun = run_send_job(&deps(&transport, &memory), &mut journal, &send_job_id, generation)
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

    let result = run_send_job(&deps(&transport, &memory), &mut journal, &send_job_id, generation)
        .unwrap();
    assert_eq!(
        result,
        SubmissionResult::Abandoned("credential_failure".to_string())
    );
    // NON-terminal: the same generation must be re-executable after the
    // cloud's credential_required → released → re-offer cycle (§6b.1).
    let job = journal.load_job(&send_job_id, generation).unwrap().unwrap();
    assert!(job.terminal_outcome.is_none());
    assert!(journal.tombstone(&send_job_id, generation).unwrap().is_none());
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

    let result = run_send_job(&deps(&transport, &memory), &mut journal, &send_job_id, generation)
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

    let result = run_send_job(&deps(&transport, &memory), &mut journal, &send_job_id, generation)
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
    let rerun = run_send_job(&deps(&transport, &memory), &mut journal, &send_job_id, generation)
        .unwrap();
    assert!(matches!(rerun, SubmissionResult::NotRunnable(_)));
    // Only ONE message attempt ever hit the wire.
    assert!(sink.state().transcript.iter().filter(|line| line.starts_with("DATA")).count() <= 1);
}

#[test]
fn cancel_before_data_settles_cancelled() {
    let sink = SmtpSink::start(SinkMode::Plain, SinkBehavior::default());
    let dir = temp_dir("cancel-run");
    let mut journal = open_journal(&dir);
    let memory = MemoryCredentialStore::new();
    let (send_job_id, generation) = seed_send_job(&mut journal, &memory, sink.port);
    journal.request_cancel(&send_job_id, generation).unwrap().unwrap();
    let transport = FakeCloudTransport::new();

    let result = run_send_job(&deps(&transport, &memory), &mut journal, &send_job_id, generation)
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
    assert!(journal.load_job(&job_a, 1).unwrap().unwrap().terminal_outcome.is_none());

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

    let result = run_send_job(&deps(&transport, &memory), &mut journal, &send_job_id, generation)
        .unwrap();
    assert_eq!(result, SubmissionResult::Abandoned("lease_fenced".to_string()));
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

    let result = run_send_job(&deps(&transport, &memory), &mut journal, &send_job_id, generation)
        .unwrap();
    assert_eq!(result, SubmissionResult::Terminal("failed".to_string()));
    assert_eq!(sink.state().messages.len(), 0, "unverified bytes never sent");
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

    // The sink runs INSIDE the subprocess (loopback only).
    let sink = SmtpSink::start(SinkMode::Plain, SinkBehavior::default());
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
        let _ = journal_command_before_ack(&mut journal, &command, "live_intake");
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
    let _ = run_send_job(&deps(&transport, &memory), &mut journal, &send_job_id, generation);
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
}

fn run_killpoint_case(case: &KillpointExpectation) {
    let dir = temp_dir(&format!("kill-{}", case.killpoint));
    let journal_path = dir.join("journal.sqlite");
    let scenario = json!({
        "journal_path": journal_path.display().to_string(),
        "stage": case.stage,
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
                let ack = journal_command_before_ack(&mut journal, &command, "replay").unwrap();
                assert_eq!(ack.result, "duplicate");
                assert!(ack.first_status_event_id.is_some());
            }
            other => panic!("unknown intake killpoint {other}"),
        }
        return;
    }

    let job_ref = std::fs::read_to_string(journal_path.with_extension("jobid"))
        .expect("job id marker");
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
                .unwrap_or_else(|| {
                    panic!("{}: recovery must settle the pair", case.killpoint)
                });
            assert_eq!(entry.2, outcome, "{}: recovery outcome", case.killpoint);
            // delivery_unknown / submitted both tombstone — never re-run.
            assert!(journal.tombstone(send_job_id, generation).unwrap().is_some());
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
    });
}

#[test]
fn crash_matrix_mid_data_recovers_delivery_unknown() {
    run_killpoint_case(&KillpointExpectation {
        killpoint: "mid_data",
        stage: "send",
        recovery_outcome: Some("delivery_unknown"),
        already_terminal: None,
        data_started: true,
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
    });
    // (pending-event re-handoff is exercised in
    // pending_events_rehandoff_after_crash below.)
}

#[test]
fn pending_events_rehandoff_after_crash() {
    let dir = temp_dir("pending");
    let mut journal = open_journal(&dir);
    journal
        .record_send_command("job-p", 1, "cmd-p", "bind-1", "hash-p", "test")
        .unwrap();
    let event = PendingEventRow {
        status_event_id: "evt-p".to_string(),
        send_job_id: "job-p".to_string(),
        generation: 1,
        payload: json!({"phase": "settled", "status_event_id": "evt-p"}),
    };
    journal.journal_terminal("job-p", 1, "submitted", &event).unwrap();
    let pending = journal.pending_events().unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].status_event_id, "evt-p");
    // Handoff + cloud ack drains the pending queue.
    journal.mark_event_handed_off("evt-p").unwrap();
    assert_eq!(journal.pending_events().unwrap().len(), 1, "handed_off still pending ack");
    journal.record_cloud_ack("evt-p", true, None).unwrap();
    assert!(journal.pending_events().unwrap().is_empty());
}

// =====================================================================
// Fixture corpus shape tests (§9/§10)
// =====================================================================

fn fixture(dir: &std::path::Path, name: &str) -> Value {
    serde_json::from_str(&std::fs::read_to_string(dir.join(name)).unwrap_or_else(|error| {
        panic!("fixture {name} unreadable: {error}")
    }))
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
    let command =
        contract::parse_email_command(contract::EMAIL_COMMAND_SEND, payload).unwrap();
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
    let parsed = contract::parse_email_command(
        contract::EMAIL_COMMAND_PREFLIGHT_RUN,
        &preflight["payload"],
    )
    .unwrap();
    if let contract::EmailCommand::PreflightRun { requested_checks, .. } = parsed {
        assert_eq!(requested_checks, vec!["public_ip", "port25_egress", "ptr_fcrdns"]);
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
            assert!(has("mode") && has("lease_id") && has("lease_epoch"), "{name}");
            contract::u64_from_wire(&event["lease_epoch"]).expect("lease_epoch string");
        } else {
            assert!(!has("mode") && !has("lease_id") && !has("lease_epoch"), "{name}");
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
            assert!(contract::ERROR_CLASSES
                .contains(&event["error_class"].as_str().unwrap()));
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
        assert!(contract::PREFLIGHT_RESULTS
            .contains(&payload["result"].as_str().unwrap()));
        let checks = payload["checks"].as_array().unwrap();
        for check in checks {
            assert!(
                contract::PREFLIGHT_CHECK_IDS.contains(&check["check_id"].as_str().unwrap()),
                "{name}: closed check id"
            );
            assert!(contract::PREFLIGHT_CHECK_STATUSES
                .contains(&check["status"].as_str().unwrap()));
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
    for key in ["capability_version", "modes", "profiles", "runtime", "credential_store"] {
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
        profiles::binding_profile_ref(&journal, binding_id).unwrap().as_deref(),
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
        saw_unknown || unknown["expect"].as_str().unwrap_or("").starts_with("reject:"),
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
    assert!(hook < generic_ack, "email hook must run before the generic ack");

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
    assert!(hook < generic_ack, "replay email hook before the generic ack");

    // Dispatcher matcher owns the email kinds (webview never handles them).
    let matcher_start = source
        .find("fn cloud_mcp_remote_command_is_rust_owned_for_dispatcher")
        .expect("matcher present");
    let matcher = &source[matcher_start..matcher_start + 4_000];
    for kind in ["\"email_send\"", "\"email_credential_probe\"", "\"email_preflight_run\""] {
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
    let live = journal_command_before_ack(&mut journal, &command, "live_intake").unwrap();
    assert_eq!(live.result, "accepted");
    let replay =
        journal_command_before_ack(&mut journal, &command, "account_sync_resume_replay").unwrap();
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

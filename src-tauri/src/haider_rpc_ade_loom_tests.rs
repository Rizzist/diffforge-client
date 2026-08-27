use super::*;

fn full_agent_type_json() -> Value {
    serde_json::json!({
        "id": "reviewer-v2",
        "name": "Reviewer / دقیق",
        "job": "Review exactly; do not infer capabilities.",
        "in_type": "Patch<Raw>",
        "out_type": "Verdict | Notes",
        "clis": ["rg", "git"],
        "apis": ["github.read", "ci/status"],
        "skills": ["Rust review", "wire-law"],
        "scripts": ["review --strict", "quote:$RAW"],
        "color": "#12aBcD",
        "glyph": "⌁",
        "rev": 37
    })
}

#[test]
fn loom_feature_constants_match_962_verbatim() {
    assert_eq!(FEATURE_LOOM_V1, "loom_v1");
    assert_eq!(FEATURE_LOOM_CLI_PRESENCE_V1, "loom_cli_presence_v1");
    assert_eq!(FEATURE_TYPED_AGENT_INSTALL_V1, "typed_agent_install_v1");
    assert_eq!(
        FEATURE_TYPED_AGENT_INSTALL_CONTROL_V1,
        "typed_agent_install_control_v1"
    );
    assert_eq!(
        FEATURE_SESSION_AGENT_TYPE_SELECT_V1,
        "session_agent_type_select_v1"
    );
}

#[test]
fn loom_mutation_agent_type_round_trips_all_fields_verbatim() {
    let raw = full_agent_type_json();
    let record: LoomAgentType =
        serde_json::from_value(raw.clone()).expect("decode every LoomAgentType field");

    assert_eq!(record.id, "reviewer-v2");
    assert_eq!(record.name, "Reviewer / دقیق");
    assert_eq!(record.job, "Review exactly; do not infer capabilities.");
    assert_eq!(record.in_type, "Patch<Raw>");
    assert_eq!(record.out_type, "Verdict | Notes");
    assert_eq!(record.clis, ["rg", "git"]);
    assert_eq!(record.apis, ["github.read", "ci/status"]);
    assert_eq!(record.skills, ["Rust review", "wire-law"]);
    assert_eq!(record.scripts, ["review --strict", "quote:$RAW"]);
    assert_eq!(record.color, "#12aBcD");
    assert_eq!(record.glyph, "⌁");
    assert_eq!(record.rev, 37);
    assert_eq!(
        serde_json::to_value(record).expect("re-encode LoomAgentType"),
        raw
    );
}

#[test]
fn loom_mutation_cli_presence_keeps_unprobed_distinct_from_false() {
    let body: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "loom.list",
        "agent_types": [full_agent_type_json()],
        "workflows": [{"future": "P0.4 ignores this vector"}],
        "cli_present": {
            "rg": true,
            "git": false
        }
    }))
    .expect("decode Loom registry response");
    let result = loom_list_response(body).expect("project Loom agent types");

    assert_eq!(result.cli_presence("rg"), Some(true));
    assert_eq!(result.cli_presence("git"), Some(false));
    assert_eq!(
        result.cli_presence("jq"),
        None,
        "missing key is not probed and must not collapse to false"
    );
    let encoded = serde_json::to_value(result).expect("encode Loom list result");
    assert!(encoded["cli_present"].get("jq").is_none());
}

#[test]
fn loom_mutation_register_receipt_keeps_install_job_id() {
    let body: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "loom.registered",
        "registration": {
            "id": "reviewer-v2",
            "rev": 38,
            "digest": "digest-from-daemon",
            "updated": true
        },
        "install_job_id": "install:reviewer-v2:38"
    }))
    .expect("decode 962 Loom registration response");
    let receipt = loom_registration_response(body).expect("project registration receipt");

    assert_eq!(receipt.id, "reviewer-v2");
    assert_eq!(receipt.rev, 38);
    assert_eq!(receipt.digest, "digest-from-daemon");
    assert!(receipt.updated);
    assert_eq!(
        receipt.install_job_id.as_deref(),
        Some("install:reviewer-v2:38"),
        "the executor-ready job coordinate must reach the SDK caller"
    );
}

#[test]
fn loom_mutation_unknown_install_values_round_trip_raw() {
    let raw_state = serde_json::json!("waiting_on_device");
    let state: TypedAgentInstallState =
        serde_json::from_value(raw_state.clone()).expect("decode future install state");
    assert_eq!(
        state,
        TypedAgentInstallState::Unknown("waiting_on_device".to_string())
    );
    assert_eq!(
        serde_json::to_value(state).expect("re-encode future install state"),
        raw_state,
        "unknown state string must remain available to JS"
    );

    let raw_retry_outcome = serde_json::json!({
        "status": "deferred",
        "ticket": "opaque-77",
        "retry_after_ms": 0
    });
    let retry: TypedAgentInstallRetryReceipt = serde_json::from_value(serde_json::json!({
        "job_id": "install:reviewer-v2:38",
        "outcome": raw_retry_outcome.clone()
    }))
    .expect("decode future retry outcome");
    assert!(matches!(
        retry.outcome,
        TypedAgentInstallRetryOutcome::Unknown { .. }
    ));
    assert_eq!(
        serde_json::to_value(retry).expect("re-encode future retry outcome")["outcome"],
        raw_retry_outcome
    );

    let raw_watch_outcome = serde_json::json!({
        "status": "compacted",
        "head": 91,
        "baseline": {"opaque": true}
    });
    let watch: TypedAgentInstallWatchReceipt = serde_json::from_value(serde_json::json!({
        "job_id": "install:reviewer-v2:38",
        "outcome": raw_watch_outcome.clone()
    }))
    .expect("decode future watch outcome");
    assert!(matches!(
        watch.outcome,
        TypedAgentInstallWatchOutcome::Unknown { .. }
    ));
    assert_eq!(
        serde_json::to_value(watch).expect("re-encode future watch outcome")["outcome"],
        raw_watch_outcome
    );
}

#[test]
fn loom_install_status_and_watch_keep_daemon_progress_coordinates() {
    let body: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "loom.install.status",
        "jobs": [{
            "job_id": "install:reviewer-v2:38",
            "agent_type_id": "reviewer-v2",
            "agent_type_rev": 38,
            "agent_type_digest": "0123456789abcdef0123456789abcdef",
            "state": "installing",
            "progress": {"total": 2, "completed": 0, "current_cli": "rg"},
            "created_at_ms": 0,
            "updated_at_ms": 12
        }],
        "items": [{
            "job_id": "install:reviewer-v2:38",
            "ordinal": 0,
            "required_cli": {"program": "rg"},
            "state": "verifying",
            "created_at_ms": 0,
            "updated_at_ms": 11
        }]
    }))
    .expect("decode typed install status");
    let status = loom_install_status_response(body).expect("project typed install status");
    assert_eq!(status.jobs[0].state, TypedAgentInstallState::Installing);
    assert_eq!(status.jobs[0].progress.completed, 0);
    assert_eq!(status.jobs[0].progress.current_cli.as_deref(), Some("rg"));
    assert_eq!(status.items[0].ordinal, 0);
    assert_eq!(status.items[0].state, TypedAgentInstallState::Verifying);

    let body: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "loom.install.watch",
        "receipt": {
            "job_id": "install:reviewer-v2:38",
            "outcome": {
                "status": "watching",
                "requested_after_cursor": 40,
                "replay_through_cursor": 44,
                "next_cursor": 42,
                "events": [{
                    "cursor": 42,
                    "job": status.jobs[0]
                }]
            }
        }
    }))
    .expect("decode install watch page");
    let receipt = loom_install_watch_response(body).expect("project install watch page");
    let TypedAgentInstallWatchOutcome::Watching {
        requested_after_cursor,
        replay_through_cursor,
        next_cursor,
        events,
    } = receipt.outcome
    else {
        panic!("expected watching outcome");
    };
    assert_eq!(requested_after_cursor, 40);
    assert_eq!(replay_through_cursor, 44);
    assert_eq!(next_cursor, 42);
    assert_eq!(events[0].cursor, 42);
    assert_eq!(events[0].job.state, TypedAgentInstallState::Installing);
}

#[test]
fn loom_request_shapes_match_962_methods() {
    let mut record: LoomAgentType =
        serde_json::from_value(full_agent_type_json()).expect("decode agent record");
    record.rev = 0;
    let mut expected_record = full_agent_type_json();
    expected_record["rev"] = serde_json::json!(0);
    assert_eq!(
        serde_json::to_value(RequestBody::LoomRegisterAgentType {
            record: record.clone()
        })
        .expect("encode register request"),
        serde_json::json!({"method": "loom.register_agent_type", "record": expected_record})
    );
    assert_eq!(
        serde_json::to_value(RequestBody::LoomInstallStatus {
            job_id: None,
            agent_type_id: Some(record.id.clone())
        })
        .expect("encode install status request"),
        serde_json::json!({
            "method": "loom.install.status",
            "agent_type_id": "reviewer-v2"
        })
    );
    assert_eq!(
        serde_json::to_value(RequestBody::LoomInstallRetry {
            job_id: "install:reviewer-v2:38".to_string()
        })
        .expect("encode retry request"),
        serde_json::json!({
            "method": "loom.install.retry",
            "job_id": "install:reviewer-v2:38"
        })
    );
    assert_eq!(
        serde_json::to_value(RequestBody::LoomInstallWatch {
            job_id: "install:reviewer-v2:38".to_string(),
            after_cursor: 42
        })
        .expect("encode watch request"),
        serde_json::json!({
            "method": "loom.install.watch",
            "job_id": "install:reviewer-v2:38",
            "after_cursor": 42
        })
    );
}

#[test]
fn loom_select_receipt_is_a_persona_binding_not_readiness() {
    let body: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "session.select_agent_type",
        "session_id": "session-1",
        "agent_type": "reviewer-v2",
        "selected_seq": 77,
        "worker_generation": 9
    }))
    .expect("decode persona binding receipt");
    let receipt = session_agent_type_persona_binding_response(body, "session-1")
        .expect("project persona binding receipt");

    assert_eq!(receipt.session_id, "session-1");
    assert_eq!(receipt.agent_type.as_deref(), Some("reviewer-v2"));
    assert_eq!(receipt.selected_seq, 77);
    assert_eq!(receipt.worker_generation, 9);
    assert_eq!(
        serde_json::to_value(receipt).expect("encode persona binding receipt"),
        serde_json::json!({
            "session_id": "session-1",
            "agent_type": "reviewer-v2",
            "selected_seq": 77,
            "worker_generation": 9
        })
    );
}

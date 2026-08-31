#![allow(clippy::expect_used)]

use super::*;

const ABOVE_JS_SAFE_INTEGER: u64 = 9_007_199_254_740_993;

#[cfg(unix)]
fn attachment() -> WorkflowControlAttachment {
    WorkflowControlAttachment {
        attachment_id: "attachment-agent-cancel".to_string(),
        session_id: "provider-session-authority".to_string(),
        worker_generation: 73,
        replay_through_seq: 211,
    }
}

#[cfg(unix)]
#[test]
fn cancel_coordinates_come_only_from_the_control_attachment() {
    let request = serde_json::to_value(agent_cancel_request(
        &attachment(),
        "agent-child-opaque".to_string(),
    ))
    .expect("serialize agent.cancel request");

    assert_eq!(request["session_id"], "provider-session-authority");
    assert_eq!(request["worker_generation"], 73);
    assert_eq!(request["agent"], "agent-child-opaque");
    assert!(
        request["command_id"]
            .as_str()
            .is_some_and(|command_id| command_id.starts_with("diffforge-agent-cancel-")),
        "command_id must be minted inside the SDK: {request}"
    );

    fn accepts_only_user_coordinates<Fut>(_: fn(String, String) -> Fut) {}
    accepts_only_user_coordinates(agent_cancel);
}

#[test]
fn already_terminal_is_normal_and_unknown_cancel_status_preserves_raw() {
    let already_terminal: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "agent.cancel",
        "agent": "agent-child-7",
        "child_session_id": "session-child-7",
        "child_run_id": "run-child-7",
        "status": "already_terminal",
        "terminal_seq": 144
    }))
    .expect("decode already-terminal response");
    let receipt = agent_cancel_response(already_terminal)
        .expect("AlreadyTerminal is an ordinary successful cancellation receipt");
    assert_eq!(receipt.status, AgentCancelStatusV1::AlreadyTerminal);
    assert_eq!(receipt.terminal_seq, Some(144));

    let future: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "agent.cancel",
        "agent": "agent-child-8",
        "child_session_id": "session-child-8",
        "child_run_id": "run-child-8",
        "status": "accepted_after_future_recovery"
    }))
    .expect("decode future cancel status");
    let future = agent_cancel_response(future).expect("future status remains a receipt");
    assert!(matches!(
        &future.status,
        AgentCancelStatusV1::Unknown(raw) if raw == "accepted_after_future_recovery"
    ));
    assert_eq!(
        serde_json::to_value(future.status).expect("re-encode future status"),
        serde_json::json!("accepted_after_future_recovery")
    );
}

#[test]
fn terminal_seq_is_an_exact_optional_decimal_string_at_tauri() {
    let present = serde_json::to_value(AgentCancelReceiptV1 {
        agent: "agent-present".to_string(),
        child_session_id: "session-present".to_string(),
        child_run_id: "run-present".to_string(),
        status: AgentCancelStatusV1::AlreadyTerminal,
        terminal_seq: Some(ABOVE_JS_SAFE_INTEGER),
    })
    .expect("serialize present terminal sequence");
    assert_eq!(
        present["terminal_seq"],
        serde_json::json!(ABOVE_JS_SAFE_INTEGER.to_string())
    );
    assert_eq!(
        present["terminal_seq"]
            .as_str()
            .expect("terminal sequence must be a string")
            .parse::<u64>()
            .expect("round-trip exact terminal sequence"),
        ABOVE_JS_SAFE_INTEGER
    );

    let absent = serde_json::to_value(AgentCancelReceiptV1 {
        agent: "agent-absent".to_string(),
        child_session_id: "session-absent".to_string(),
        child_run_id: "run-absent".to_string(),
        status: AgentCancelStatusV1::Accepted,
        terminal_seq: None,
    })
    .expect("serialize absent terminal sequence");
    assert!(
        absent.get("terminal_seq").is_none(),
        "None must stay typed absence, not null or zero: {absent}"
    );
}

#[cfg(unix)]
#[test]
fn admission_rejection_is_typed_and_success_keeps_the_legacy_receipt_shape() {
    let (request, features) = session_create_request_with_admission(
        "/work".to_string(),
        String::new(),
        String::new(),
        4096,
        None,
        None,
        None,
        Some(SessionCreateAdmissionV1 {
            account_alias: Some("work".to_string()),
            resolve_provider: Some(true),
            resolve_model: Some(true),
            effort: Some("xhigh".to_string()),
            fast: Some(false),
        }),
    )
    .expect("build admitted session.create request");
    assert!(features.contains(FEATURE_SESSION_CREATE_ADMISSION_V1));
    assert!(features.contains(FEATURE_SESSION_ACCOUNT_SELECT_V1));
    let request = serde_json::to_value(request).expect("serialize admission request");
    assert_eq!(request["account_alias"], "work");
    assert_eq!(request["resolve_provider"], true);
    assert_eq!(request["resolve_model"], true);
    assert_eq!(request["effort"], "xhigh");
    assert_eq!(
        request.get("fast"),
        Some(&serde_json::json!(false)),
        "explicit false is a published admission fact: {request}"
    );
    let request: RequestBody =
        serde_json::from_value(request).expect("round-trip explicit false admission request");
    let request =
        serde_json::to_value(request).expect("re-encode explicit false admission request");
    assert_eq!(request.get("fast"), Some(&serde_json::json!(false)));

    let (request, _) = session_create_request_with_admission(
        "/work".to_string(),
        String::new(),
        String::new(),
        4096,
        None,
        None,
        None,
        Some(SessionCreateAdmissionV1::default()),
    )
    .expect("build admission request with absent fast");
    let request = serde_json::to_value(request).expect("serialize absent fast admission request");
    assert!(
        request.get("fast").is_none(),
        "None must stay absent: {request}"
    );
    let request: RequestBody =
        serde_json::from_value(request).expect("round-trip absent fast admission request");
    let request = serde_json::to_value(request).expect("re-encode absent fast admission request");
    assert!(
        request.get("fast").is_none(),
        "None must stay absent: {request}"
    );

    let rejection: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "error",
        "code": "model_unknown",
        "message": "the model was not admitted",
        "retryable": false,
        "data": {
            "kind": "model_unknown",
            "provider": "future-provider",
            "model": "future-model",
            "inventory_age": 77
        }
    }))
    .expect("decode correlated admission rejection");
    let rejection = session_create_response(rejection)
        .expect_err("an admission rejection must never be coerced into create success");
    assert_eq!(rejection.code, "model_unknown");
    assert!(matches!(
        rejection.data,
        Some(SessionCreateAdmissionDataV1::ModelUnknown {
            provider,
            model,
            inventory_age_ms: Some(77),
        }) if provider == "future-provider" && model == "future-model"
    ));

    let success: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "session.create",
        "session_id": "session-created",
        "created_seq": 31,
        "worker_generation": 9,
        "metadata": {"future": {"opaque": true}}
    }))
    .expect("decode legacy-shaped create success");
    let success = session_create_response(success).expect("project create success");
    assert_eq!(
        serde_json::to_value(success).expect("serialize create receipt"),
        serde_json::json!({
            "session_id": "session-created",
            "created_seq": "31",
            "worker_generation": "9",
            "metadata": {"future": {"opaque": true}}
        }),
        "admission must not add a success field to the existing receipt"
    );
}

#[test]
fn manifest_provider_survives_verbatim_and_absence_never_defaults() {
    let present: FleetNodeWire = serde_json::from_value(serde_json::json!({
        "agent_id": "agent-present",
        "session_id": "session-child",
        "callsign": "Mica",
        "provider": "  provider-verbatim  ",
        "task": "inspect provider truth",
        "depth": 1,
        "parent_session_id": "session-parent",
        "state": "live",
        "children": []
    }))
    .expect("decode fleet manifest provider");
    assert_eq!(present.provider.as_deref(), Some("  provider-verbatim  "));
    let present = serde_json::to_value(present).expect("re-encode fleet provider");
    assert_eq!(present["provider"], "  provider-verbatim  ");

    let absent: FleetNodeWire = serde_json::from_value(serde_json::json!({
        "agent_id": "agent-absent",
        "session_id": "session-child-absent",
        "task": "preserve absence",
        "depth": 1,
        "parent_session_id": "session-parent-with-provider",
        "state": "queued",
        "children": []
    }))
    .expect("decode absent fleet provider");
    assert_eq!(absent.provider, None);
    let absent = serde_json::to_value(absent).expect("re-encode absent provider");
    assert!(
        absent.get("provider").is_none(),
        "parent/session provider must never be fabricated: {absent}"
    );
}

#[test]
fn status_snapshot_is_a_typed_rpc_door_without_runtime_dir_inference() {
    assert_eq!(FEATURE_STATUS_SNAPSHOT_V1, "status_snapshot_v1");
    assert_eq!(
        status_snapshot_features(),
        BTreeSet::from([FEATURE_STATUS_SNAPSHOT_V1.to_string()]),
        "the command gate must be exactly the published snapshot feature"
    );
    assert_eq!(
        serde_json::to_value(RequestBody::StatusSnapshot {})
            .expect("serialize status.snapshot request"),
        serde_json::json!({"method": "status.snapshot"})
    );

    let body: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "status.snapshot",
        "session_count": 3,
        "daemon_pid": 4242,
        "socket_path": "/private/runtime/haider.sock",
        "pid_file_path": "/private/runtime/haider.pid",
        "ready": true
    }))
    .expect("decode status.snapshot response");
    let snapshot = status_snapshot_response(body, "0.0.967".to_string(), 107)
        .expect("project status.snapshot response");
    assert_eq!(snapshot.pid, Some(4242));
    assert!(snapshot.ready);
    assert_eq!(snapshot.version, "0.0.967");
    assert_eq!(snapshot.generation, 107);
    assert_eq!(
        snapshot.socket_path.as_deref(),
        Some("/private/runtime/haider.sock")
    );
    assert_eq!(
        snapshot.runtime_dir, None,
        "967 has no runtime_dir RPC field; socket text must not be parsed"
    );
    let snapshot = serde_json::to_value(snapshot).expect("serialize status snapshot receipt");
    assert_eq!(snapshot["pid"], 4242);
    assert!(snapshot.get("daemon_pid").is_none());
}

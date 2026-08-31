#![allow(clippy::expect_used)]

use super::*;

const ABOVE_JS_SAFE_INTEGER: u64 = 9_007_199_254_740_993;

fn attachment() -> WorkflowControlAttachment {
    WorkflowControlAttachment {
        attachment_id: "attachment-lifecycle".to_string(),
        session_id: "provider-session-authority".to_string(),
        worker_generation: 41,
        replay_through_seq: 97,
    }
}

fn request_json(request: RequestBody) -> Value {
    serde_json::to_value(request).expect("serialize lifecycle request")
}

fn assert_decimal_coordinate(value: &Value, expected: u64, name: &str) {
    let decimal = value
        .as_str()
        .unwrap_or_else(|| panic!("{name} crossed Tauri as a JSON number: {value}"));
    assert_eq!(
        decimal,
        expected.to_string(),
        "{name} changed decimal bytes"
    );
    assert_eq!(
        decimal.parse::<u64>().expect("checked-parse Tauri decimal"),
        expected,
        "{name} did not round-trip to the daemon u64"
    );
}

#[test]
fn lifecycle_feature_tokens_and_conditional_create_gates_match_966() {
    assert_eq!(FEATURE_SESSION_MUTATION_V1, "session_mutation_v1");
    assert_eq!(FEATURE_SESSION_RENAME_V1, "session_rename_v1");
    assert_eq!(FEATURE_CONTEXT_COMPACTION_V1, "context_compaction_v1");
    assert_eq!(FEATURE_SESSION_FORK_V1, "session_fork_v1");
    assert_eq!(FEATURE_RUN_RETRY_V1, "run_retry_v1");
    assert_eq!(
        FEATURE_SESSION_PERMISSION_OVERRIDES_V1,
        "session_permission_overrides_v1"
    );
    assert_eq!(
        FEATURE_AUTONOMOUS_INTERACTION_V1,
        "autonomous_interaction_v1"
    );

    let (_, base) = session_create_request(
        "/work".to_string(),
        "openai".to_string(),
        "gpt-5".to_string(),
        4096,
        None,
        None,
        None,
    )
    .expect("base create request");
    assert_eq!(base, lifecycle_features(FEATURE_SESSION_MUTATION_V1));

    let (_, extended) = session_create_request(
        "/work".to_string(),
        "openai".to_string(),
        "gpt-5".to_string(),
        4096,
        Some(serde_json::json!({"shell": {"allow": false}})),
        None,
        Some("autonomous".to_string()),
    )
    .expect("extended create request");
    assert!(extended.contains(FEATURE_SESSION_MUTATION_V1));
    assert!(extended.contains(FEATURE_SESSION_PERMISSION_OVERRIDES_V1));
    assert!(extended.contains(FEATURE_AUTONOMOUS_INTERACTION_V1));
}

#[test]
fn lifecycle_rename_none_is_clear_and_distinct_from_empty_string() {
    let clear = request_json(session_rename_request(&attachment(), None));
    let empty = request_json(session_rename_request(&attachment(), Some(String::new())));

    assert!(
        clear.get("title").is_none(),
        "clear-title request must omit title and remain distinct from present empty string: {clear}"
    );
    assert_eq!(empty.get("title"), Some(&serde_json::json!("")));
    assert_ne!(
        clear, empty,
        "None must not be fabricated as an empty title"
    );

    fn accepts_optional_title<Fut>(_: fn(String, Option<String>) -> Fut) {}
    accepts_optional_title(session_rename);
}

#[test]
fn lifecycle_every_optional_argument_omits_its_wire_key() {
    let (create, _) = session_create_request(
        "/work".to_string(),
        "openai".to_string(),
        "gpt-5".to_string(),
        4096,
        None,
        None,
        None,
    )
    .expect("create request with omitted optionals");
    let create = request_json(create);
    for key in ["permission_overrides", "cache_policy", "interaction_mode"] {
        assert!(
            create.get(key).is_none(),
            "omitted optional {key} must carry no wire key, not null: {create}"
        );
    }

    let rename = request_json(session_rename_request(&attachment(), None));
    assert!(rename.get("title").is_none());
    let compact = request_json(session_compact_request(&attachment(), None));
    assert!(
        compact.get("branch_id").is_none(),
        "omitted optional branch_id must carry no wire key, not null: {compact}"
    );
    let fork = request_json(session_fork_request(&attachment(), None, None, None));
    for key in ["source_branch_id", "fork_node_id", "fork_seq"] {
        assert!(
            fork.get(key).is_none(),
            "omitted optional {key} must carry no wire key, not null: {fork}"
        );
    }

    fn accepts_create_optionals<Fut>(
        _: fn(String, String, String, u64, Option<Value>, Option<Value>, Option<String>) -> Fut,
    ) {
    }
    fn accepts_compact_optional<Fut>(_: fn(String, Option<String>) -> Fut) {}
    fn accepts_fork_optionals<Fut>(_: fn(String, Option<String>, Option<String>) -> Fut) {}
    accepts_create_optionals(session_create);
    accepts_compact_optional(session_compact);
    accepts_fork_optionals(session_fork);
}

#[test]
fn lifecycle_mutation_coordinates_come_only_from_control_attachment() {
    let attachment = attachment();
    let requests = [
        request_json(session_rename_request(&attachment, None)),
        request_json(session_compact_request(&attachment, None)),
        request_json(session_fork_request(
            &attachment,
            None,
            Some("node-41".to_string()),
            Some(41),
        )),
        request_json(run_retry_request(&attachment)),
    ];
    let prefixes = [
        "diffforge-session-rename-",
        "diffforge-session-compact-",
        "diffforge-session-fork-",
        "diffforge-run-retry-",
    ];

    for (request, prefix) in requests.iter().zip(prefixes) {
        assert_eq!(
            request["session_id"], "provider-session-authority",
            "mutation session_id must come from the Control attachment"
        );
        assert_eq!(
            request["worker_generation"], 41,
            "mutation worker_generation must come from the control attachment: {request}"
        );
        assert!(
            request["command_id"]
                .as_str()
                .is_some_and(|command_id| command_id.starts_with(prefix)),
            "mutation command_id must be minted internally with {prefix}: {request}"
        );
    }

    fn accepts_retry_without_coordinates<Fut>(_: fn(String) -> Fut) {}
    accepts_retry_without_coordinates(run_retry);
}

#[test]
fn lifecycle_create_receipt_preserves_daemon_coordinates_and_metadata_verbatim() {
    let metadata = serde_json::json!({
        "provider": "future-provider",
        "interaction_mode": "future-mode",
        "permission_overrides": {"future_permission": [1, {"opaque": true}]},
        "future_metadata": {"nested": ["keep", 7]}
    });
    let body: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "session.create",
        "session_id": "daemon-minted/SESSION::Opaque==",
        "created_seq": ABOVE_JS_SAFE_INTEGER,
        "worker_generation": ABOVE_JS_SAFE_INTEGER + 1,
        "metadata": metadata
    }))
    .expect("decode daemon session.create receipt");
    let receipt = session_create_response(body).expect("project create receipt");

    assert_eq!(
        receipt.session_id, "daemon-minted/SESSION::Opaque==",
        "create receipt session_id must be the daemon-issued coordinate"
    );
    assert_eq!(
        receipt.metadata, metadata,
        "SessionMetadataV1 must remain a verbatim Value"
    );
    assert_eq!(receipt.created_seq, ABOVE_JS_SAFE_INTEGER);
    assert_eq!(receipt.worker_generation, ABOVE_JS_SAFE_INTEGER + 1);
}

#[test]
fn lifecycle_sequences_above_2pow53_cross_tauri_as_decimal_strings() {
    let create = serde_json::to_value(SessionCreateReceipt {
        session_id: "created".to_string(),
        created_seq: ABOVE_JS_SAFE_INTEGER,
        worker_generation: ABOVE_JS_SAFE_INTEGER,
        metadata: serde_json::json!({"opaque": true}),
    })
    .expect("serialize create receipt");
    assert_decimal_coordinate(&create["created_seq"], ABOVE_JS_SAFE_INTEGER, "created_seq");
    assert_decimal_coordinate(
        &create["worker_generation"],
        ABOVE_JS_SAFE_INTEGER,
        "worker_generation",
    );

    let rename = serde_json::to_value(SessionRenameReceipt {
        session_id: "renamed".to_string(),
        title: None,
        renamed_seq: ABOVE_JS_SAFE_INTEGER,
        worker_generation: ABOVE_JS_SAFE_INTEGER,
    })
    .expect("serialize rename receipt");
    assert_decimal_coordinate(&rename["renamed_seq"], ABOVE_JS_SAFE_INTEGER, "renamed_seq");

    let compact = serde_json::to_value(SessionCompactReceipt {
        session_id: "compacted".to_string(),
        run_id: "run-compact".to_string(),
        accepted_seq: ABOVE_JS_SAFE_INTEGER,
        worker_generation: ABOVE_JS_SAFE_INTEGER,
        branch_id: None,
    })
    .expect("serialize compact receipt");
    assert_decimal_coordinate(
        &compact["accepted_seq"],
        ABOVE_JS_SAFE_INTEGER,
        "compact accepted_seq",
    );

    let fork = serde_json::to_value(SessionForkReceipt {
        session_id: "child".to_string(),
        source_session_id: "source".to_string(),
        source_branch_id: None,
        fork_node_id: "node".to_string(),
        fork_seq: ABOVE_JS_SAFE_INTEGER,
        created_seq: ABOVE_JS_SAFE_INTEGER,
        worker_generation: ABOVE_JS_SAFE_INTEGER,
        metadata: serde_json::json!({"opaque": true}),
        forked_from: None,
        draft: None,
    })
    .expect("serialize fork receipt");
    for key in ["fork_seq", "created_seq", "worker_generation"] {
        assert_decimal_coordinate(&fork[key], ABOVE_JS_SAFE_INTEGER, key);
    }

    let retry = serde_json::to_value(RunRetryReceipt {
        session_id: "retry".to_string(),
        run_id: "new-run".to_string(),
        failed_run_id: "failed-run".to_string(),
        user_seq: ABOVE_JS_SAFE_INTEGER,
        accepted_seq: ABOVE_JS_SAFE_INTEGER,
        worker_generation: ABOVE_JS_SAFE_INTEGER,
    })
    .expect("serialize retry receipt");
    for key in ["user_seq", "accepted_seq", "worker_generation"] {
        assert_decimal_coordinate(&retry[key], ABOVE_JS_SAFE_INTEGER, key);
    }
}

#[test]
fn lifecycle_fork_resolves_sequence_only_from_raw_daemon_envelopes() {
    let envelopes = vec![
        serde_json::json!({
            "seq": 16,
            "payload": {"type": "session_state", "state": "idle"}
        }),
        serde_json::json!({
            "seq": ABOVE_JS_SAFE_INTEGER,
            "payload": {
                "type": "node_committed",
                "node": {"node": "opaque-node", "future": {"keep": true}}
            }
        }),
    ];

    assert_eq!(
        lifecycle_fork_seq_in_envelopes(&envelopes, "opaque-node")
            .expect("resolve authoritative raw-envelope sequence"),
        Some(ABOVE_JS_SAFE_INTEGER)
    );
    assert_eq!(
        lifecycle_fork_seq_in_envelopes(&envelopes, "absent-node")
            .expect("scan without fabricating a sequence"),
        None
    );
}

#[test]
fn lifecycle_receipts_preserve_daemon_fork_and_retry_coordinates() {
    let fork_metadata = serde_json::json!({"future": {"keep": [1, 2, 3]}});
    let forked_from = serde_json::json!({"session_id": "source", "seq": 17, "future": true});
    let draft = serde_json::json!({"text": "editable", "attachments": [{"future": true}]});
    let fork: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "session.fork",
        "session_id": "daemon-child",
        "source_session_id": "daemon-source",
        "source_branch_id": "branch-a",
        "fork_node_id": "node-17",
        "fork_seq": 17,
        "created_seq": 18,
        "worker_generation": 7,
        "metadata": fork_metadata,
        "forked_from": forked_from,
        "draft": draft
    }))
    .expect("decode fork receipt");
    let fork = session_fork_response(fork).expect("project fork receipt");
    assert_eq!(fork.session_id, "daemon-child");
    assert_eq!(fork.source_session_id, "daemon-source");
    assert_eq!(fork.metadata, fork_metadata);
    assert_eq!(fork.forked_from, Some(forked_from));
    assert_eq!(fork.draft, Some(draft));

    let retry: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "run.retry",
        "session_id": "daemon-source",
        "run_id": "daemon-run-new",
        "failed_run_id": "daemon-run-failed",
        "user_seq": 11,
        "accepted_seq": 19,
        "worker_generation": 7
    }))
    .expect("decode retry receipt");
    let retry = run_retry_response(retry).expect("project retry receipt");
    assert_eq!(retry.run_id, "daemon-run-new");
    assert_eq!(retry.failed_run_id, "daemon-run-failed");
}

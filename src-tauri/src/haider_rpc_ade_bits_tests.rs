use super::*;

fn body_json(body: RequestBody) -> Value {
    serde_json::to_value(body).expect("request body serializes")
}

#[test]
fn bits_publish_the_exact_feature_names() {
    assert_eq!(FEATURE_BRANCH_CREATE_V1, "branch_create_v1");
    assert_eq!(FEATURE_RUN_BUDGET_V1, "run_budget_v1");
    assert_eq!(FEATURE_SESSION_PROMPT_FORK_V1, "session_prompt_fork_v1");
    assert_eq!(FEATURE_HEADLESS_RUN_V1, "headless_run_v1");
    assert_eq!(FEATURE_SESSION_ATTACH_SEALED_V1, "session_attach_sealed_v1");
    assert_eq!(
        FEATURE_COMPUTER_PERMISSION_ACTIONS_V1,
        "computer_permission_actions_v1"
    );
    assert_eq!(FEATURE_TRANSCRIPTION_V1, "transcription_v1");
    assert_eq!(FEATURE_ACCOUNT_LABEL_V1, "account_label_v1");
}

#[test]
fn branch_create_and_existing_branch_scopes_are_additive() {
    let branch = body_json(RequestBody::BranchCreate {
        command_id: "command-1".to_string(),
        session_id: "session-1".to_string(),
        worker_generation: 7,
        source_branch_id: None,
        fork_node_id: "node-9".to_string(),
        fork_seq: 9,
        name: None,
    });
    assert_eq!(
        branch,
        serde_json::json!({
            "method": "branch.create",
            "command_id": "command-1",
            "session_id": "session-1",
            "worker_generation": 7,
            "fork_node_id": "node-9",
            "fork_seq": 9
        })
    );

    let compact_main = body_json(RequestBody::SessionCompact {
        command_id: "command-2".to_string(),
        session_id: "session-1".to_string(),
        worker_generation: 7,
        branch_id: None,
    });
    assert!(compact_main.get("branch_id").is_none());
    let compact_branch = body_json(RequestBody::SessionCompact {
        command_id: "command-2".to_string(),
        session_id: "session-1".to_string(),
        worker_generation: 7,
        branch_id: Some("branch-a".to_string()),
    });
    assert_eq!(compact_branch["branch_id"], "branch-a");

    let submit_main = body_json(resident_turn_submit_body(
        "command-3".to_string(),
        "session-1".to_string(),
        7,
        None,
        "hello".to_string(),
        DeliveryMode::Queue,
    ));
    assert!(submit_main.get("branch_id").is_none());
    let submit_branch = body_json(resident_turn_submit_body(
        "command-3".to_string(),
        "session-1".to_string(),
        7,
        Some("branch-a".to_string()),
        "hello".to_string(),
        DeliveryMode::Queue,
    ));
    assert_eq!(submit_branch["branch_id"], "branch-a");
}

#[cfg(unix)]
#[test]
fn branch_scoped_submit_requires_the_branch_feature_on_the_shared_path() {
    assert_eq!(
        resident_turn_submit_features(false, false),
        BTreeSet::from([FEATURE_RESIDENT_TURN_SUBMIT_V1.to_string()])
    );
    assert_eq!(
        resident_turn_submit_features(false, true),
        BTreeSet::from([
            FEATURE_BRANCH_CREATE_V1.to_string(),
            FEATURE_RESIDENT_TURN_SUBMIT_V1.to_string(),
        ])
    );
}

#[test]
fn branch_and_compact_receipts_stringify_sequences() {
    let branch = branch_create_response(ResponseBody::BranchCreate {
        session_id: "session-1".to_string(),
        branch_id: "branch-a".to_string(),
        source_branch_id: None,
        fork_node_id: "node-9".to_string(),
        fork_seq: 9_007_199_254_740_993,
        created_seq: 9_007_199_254_740_994,
        worker_generation: 9_007_199_254_740_995,
        name: "review".to_string(),
    })
    .expect("branch receipt");
    let branch = serde_json::to_value(branch).expect("branch receipt serializes");
    assert_eq!(branch["fork_seq"], "9007199254740993");
    assert_eq!(branch["created_seq"], "9007199254740994");
    assert_eq!(branch["worker_generation"], "9007199254740995");

    let compact = session_compact_response(ResponseBody::SessionCompactOnBranch {
        session_id: "session-1".to_string(),
        run_id: "run-1".to_string(),
        accepted_seq: 9_007_199_254_740_996,
        worker_generation: 11,
        branch_id: "branch-a".to_string(),
    })
    .expect("branch compact receipt");
    let compact = serde_json::to_value(compact).expect("compact receipt serializes");
    assert_eq!(compact["accepted_seq"], "9007199254740996");
    assert_eq!(compact["branch_id"], "branch-a");
}

#[tokio::test]
async fn prompt_and_node_selectors_are_mutually_exclusive_before_io() {
    let error = session_fork_with_prompt(
        "session-1".to_string(),
        None,
        Some("node-1".to_string()),
        Some(SessionForkPromptSelectorV1 {
            seq: "9007199254740993".to_string(),
        }),
    )
    .await
    .expect_err("both selectors must fail locally");
    assert_eq!(error.code, "invalid_argument");
    assert_eq!(
        error.message,
        "session.fork requires exactly one of fork_node_id or prompt"
    );

    let error = session_fork_with_prompt("session-1".to_string(), None, None, None)
        .await
        .expect_err("missing selectors must fail locally");
    assert_eq!(error.code, "invalid_argument");
}

#[test]
fn prompt_fork_omits_legacy_coordinates_and_preserves_draft() {
    let request = body_json(RequestBody::SessionFork {
        command_id: "command-1".to_string(),
        session_id: "session-1".to_string(),
        worker_generation: 5,
        source_branch_id: None,
        fork_node_id: None,
        fork_seq: None,
        prompt: Some(SessionForkPromptSelectorWire {
            seq: 9_007_199_254_740_993,
        }),
    });
    assert!(request.get("source_branch_id").is_none());
    assert!(request.get("fork_node_id").is_none());
    assert!(request.get("fork_seq").is_none());
    assert_eq!(request["prompt"]["seq"], 9_007_199_254_740_993_u64);

    let draft = serde_json::json!({
        "text": "edit me",
        "attachments": [{"kind": "future_attachment", "opaque": {"x": 1}}]
    });
    let receipt = session_fork_response_with_prompt(
        ResponseBody::SessionFork {
            session_id: "child-1".to_string(),
            source_session_id: "session-1".to_string(),
            source_branch_id: None,
            fork_node_id: "node-before-prompt".to_string(),
            fork_seq: 12,
            created_seq: 20,
            worker_generation: 5,
            metadata: serde_json::json!({"future": true}),
            forked_from: Some(serde_json::json!({
                "session_id": "session-1",
                "seq": 9_007_199_254_740_993_u64
            })),
            draft: Some(draft.clone()),
        },
        true,
    )
    .expect("prompt fork receipt");
    assert_eq!(receipt.draft, Some(draft));
    assert_eq!(
        receipt.forked_from,
        Some(serde_json::json!({
            "session_id": "session-1",
            "seq": "9007199254740993"
        }))
    );
}

#[test]
fn no_create_budget_is_fabricated_and_headless_budget_is_explicit() {
    let create = body_json(RequestBody::SessionCreate {
        command_id: "command-1".to_string(),
        cwd: "/workspace".to_string(),
        provider: "provider".to_string(),
        model: "model".to_string(),
        max_tokens: 4_096,
        permission_overrides: None,
        cache_policy: None,
        interaction_mode: None,
        account_alias: None,
        resolve_provider: false,
        resolve_model: false,
        effort: None,
        fast: None,
    });
    assert!(create.get("budget").is_none());
    assert!(create.get("permission_overrides").is_none());
    assert!(create.get("cache_policy").is_none());

    let absent = headless_spec_features(&serde_json::json!({
        "cwd": "/workspace",
        "provider": "provider",
        "model": "model",
        "max_output_tokens": 4096,
        "fast": false
    }))
    .expect("budget-free headless spec");
    assert_eq!(
        absent.0,
        BTreeSet::from([FEATURE_HEADLESS_RUN_V1.to_string()])
    );
    assert!(!absent.1);

    let present = headless_spec_features(&serde_json::json!({
        "cwd": "/workspace",
        "provider": "provider",
        "model": "model",
        "max_output_tokens": 4096,
        "fast": false,
        "budget": {"max_tokens": 123}
    }))
    .expect("budgeted headless spec");
    assert!(present.0.contains(FEATURE_HEADLESS_RUN_V1));
    assert!(present.0.contains(FEATURE_RUN_BUDGET_V1));

    let budget = RunBudgetV1 {
        max_tokens: Some(123),
        max_cost_microusd: None,
        max_time_ms: None,
    };
    assert!(!budget.is_empty());
    assert_eq!(
        serde_json::to_value(budget).expect("budget serializes"),
        serde_json::json!({"max_tokens": 123})
    );
}

#[test]
fn headless_status_round_trips_large_sequences_as_decimal_strings() {
    let spec = serde_json::json!({
        "cwd": "/workspace",
        "provider": "future-provider",
        "model": "future-model",
        "max_output_tokens": 4096,
        "fast": true,
        "future_policy": {"opaque": [1, 2, 3]}
    });
    let status = headless_run_status_response(ResponseBody::HeadlessRunStatus {
        session_id: "session-1".to_string(),
        run_id: "run-1".to_string(),
        worker_generation: 9_007_199_254_740_993,
        state: RunStateWire::Unknown(serde_json::json!({
            "state": "future_terminal",
            "reason": {"opaque": true}
        })),
        head_seq: 9_007_199_254_740_994,
        terminal_seq: Some(9_007_199_254_740_995),
        budget_exhausted: None,
        spec: spec.clone(),
    })
    .expect("headless status");
    let status = serde_json::to_value(status).expect("headless status serializes");
    assert_eq!(status["worker_generation"], "9007199254740993");
    assert_eq!(status["head_seq"], "9007199254740994");
    assert_eq!(status["terminal_seq"], "9007199254740995");
    assert_eq!(status["spec"], spec);
    assert_eq!(status["state"]["state"], "future_terminal");
}

#[test]
fn sealed_replay_none_is_byte_identical_and_some_is_explicit() {
    let legacy = WireFrame::Request {
        request_id: "request-1".to_string(),
        body: RequestBody::SessionAttach {
            session_id: "session-1".to_string(),
            after_seq: 42,
            mode: AttachMode::Control,
            sealed_replay: None,
        },
    };
    let legacy = encode_framed(&legacy, DEFAULT_FRAME_LIMIT).expect("legacy attach serializes");
    assert_eq!(
        std::str::from_utf8(&legacy[4..]).expect("legacy attach is JSON"),
        r#"{"v":1,"kind":"request","request_id":"request-1","body":{"method":"session.attach","session_id":"session-1","after_seq":42,"mode":"control"}}"#
    );

    let sealed = body_json(RequestBody::SessionAttach {
        session_id: "session-1".to_string(),
        after_seq: 42,
        mode: AttachMode::Control,
        sealed_replay: Some(true),
    });
    assert_eq!(sealed["sealed_replay"], true);
}

#[test]
fn permission_action_uses_exact_coordinates_and_unknown_values_survive() {
    let request = body_json(RequestBody::ComputerPermissionOpenSettings {
        session_id: "session-1".to_string(),
        request_id: "permission-1".to_string(),
        permission: SystemPermissionV1::Unknown("future_permission".to_string()),
    });
    assert_eq!(
        request,
        serde_json::json!({
            "method": "computer.permission_open_settings",
            "session_id": "session-1",
            "request_id": "permission-1",
            "permission": "future_permission"
        })
    );

    let features = BTreeSet::from([FEATURE_COMPUTER_PERMISSION_ACTIONS_V1.to_string()]);
    let fact = parse_ade_durable_fact(
        &features,
        &serde_json::json!({
            "type": "permission_grant_needed",
            "request_id": "permission-1",
            "menu_id": "menu-1",
            "request_seq": 9_007_199_254_740_993_u64,
            "opening_generation": 3,
            "call_id": "call-1",
            "effect_id": "effect-1",
            "permission": "future_permission",
            "pane_name": "Privacy",
            "settings_url": "x-apple.systempreferences:privacy",
            "actions": ["open_settings", "future_action"],
            "auto_restart_pending": false,
            "poll_timeout_ms": 30_000
        }),
    )
    .expect("permission fact decodes")
    .expect("permission fact recognized");
    let fact = serde_json::to_value(fact).expect("permission fact serializes");
    assert_eq!(fact["request_id"], "permission-1");
    assert_eq!(fact["request_seq"], "9007199254740993");
    assert_eq!(fact["permission"], "future_permission");
    assert_eq!(fact["actions"][1], "future_action");
}

#[test]
fn durable_budget_facts_decode_only_under_the_budget_feature() {
    let decision = serde_json::json!({
        "kind": "future_budget_decision",
        "policy": {"mode": "hold", "opaque": [1, {"future": true}]}
    });
    let exhausted = serde_json::json!({
        "type": "run_budget_exhausted",
        "dimension": "future_dimension",
        "limit": 100,
        "usage": {
            "logical_input_tokens": 61,
            "billed_output_tokens": 40,
            "additional_reasoning_tokens": 0,
            "cache_read_tokens": 5,
            "cache_write_tokens": 2,
            "total_tokens": 101,
            "elapsed_ms": 500
        },
        "decision": decision
    });
    assert_eq!(
        parse_ade_durable_fact(&BTreeSet::new(), &exhausted).expect("ungated parse"),
        None
    );
    let features = BTreeSet::from([FEATURE_RUN_BUDGET_V1.to_string()]);
    let decoded = parse_ade_durable_fact(&features, &exhausted)
        .expect("budget fact decodes")
        .expect("budget fact recognized");
    match &decoded {
        AdeDurableFactV1::RunBudgetExhausted(fact) => {
            assert_eq!(fact.decision.as_ref(), Some(&decision));
        }
        other => panic!("expected budget exhaustion fact, got {other:?}"),
    }
    assert_eq!(
        serde_json::to_value(decoded).expect("budget fact serializes"),
        exhausted,
        "the complete optional decision must round-trip verbatim"
    );

    let without_decision = serde_json::json!({
        "type": "run_budget_exhausted",
        "dimension": "tokens",
        "limit": 100,
        "usage": {
            "logical_input_tokens": 61,
            "billed_output_tokens": 40,
            "additional_reasoning_tokens": 0,
            "cache_read_tokens": 5,
            "cache_write_tokens": 2,
            "total_tokens": 101,
            "elapsed_ms": 500
        }
    });
    let decoded_without_decision = parse_ade_durable_fact(&features, &without_decision)
        .expect("budget fact without a decision decodes")
        .expect("budget fact without a decision is recognized");
    match &decoded_without_decision {
        AdeDurableFactV1::RunBudgetExhausted(fact) => assert_eq!(fact.decision, None),
        other => panic!("expected budget exhaustion fact, got {other:?}"),
    }
    assert_eq!(
        serde_json::to_value(decoded_without_decision)
            .expect("budget fact without a decision serializes"),
        without_decision,
        "typed absence must remain omitted"
    );

    let failed = parse_ade_durable_fact(
        &features,
        &serde_json::json!({
            "type": "run_failed",
            "code": "budget_exhausted",
            "message": "token budget exhausted",
            "retryable": false,
            "presentation": {"kind": "future"}
        }),
    )
    .expect("budget failure decodes")
    .expect("budget failure recognized");
    let failed = serde_json::to_value(failed).expect("budget failure serializes");
    assert_eq!(failed["type"], "run_failed");
    assert_eq!(failed["code"], "budget_exhausted");
    assert_eq!(
        failed["presentation"],
        serde_json::json!({"kind": "future"})
    );
}

#[test]
fn transcription_secret_is_redacted_and_set_returns_only_presence() {
    let secret_text = "do-not-print-this-secret";
    let secret = SecretWire::new(secret_text.to_string());
    let debug = format!("{secret:?}");
    assert!(!debug.contains(secret_text));
    assert_eq!(debug, "SecretWire(REDACTED)");
    assert!(validate_transcription_secret(&secret, false).is_ok());

    let error = TranscriptionCommandErrorV1::invalid_argument(
        "transcription.secret_set requires a non-empty secret",
    );
    assert!(!format!("{error:?}").contains(secret_text));
    assert!(
        !serde_json::to_string(&error)
            .expect("secret-safe error serializes")
            .contains(secret_text)
    );
    let hostile = TranscriptionCommandErrorV1::transport(secret_text.to_string());
    assert_eq!(hostile.code, "rejected");
    assert!(!format!("{hostile:?}").contains(secret_text));
    assert!(
        !serde_json::to_string(&hostile)
            .expect("hostile daemon error is sanitized")
            .contains(secret_text)
    );

    assert_eq!(
        serde_json::to_value(TranscriptionSecretSetResultV1 { present: true })
            .expect("set result serializes"),
        serde_json::json!({"present": true})
    );
    assert_eq!(
        serde_json::to_value(TranscriptionSecretGetResultV1 { secret: None })
            .expect("absent get result serializes"),
        serde_json::json!({})
    );
}

#[test]
fn transcription_secret_set_missing_clear_defaults_false_at_tauri_and_wire_boundaries() {
    trait ClearInvokeArgument: serde::de::DeserializeOwned {
        fn wire_value(self) -> bool;
    }

    impl ClearInvokeArgument for Option<bool> {
        fn wire_value(self) -> bool {
            self.unwrap_or(false)
        }
    }

    impl ClearInvokeArgument for bool {
        fn wire_value(self) -> bool {
            self
        }
    }

    fn request_from_missing_clear<T, F, Fut>(_command: F) -> RequestBody
    where
        T: ClearInvokeArgument,
        F: Fn(SecretWire, T) -> Fut,
    {
        let invoke = serde_json::json!({"secret": "test-transcription-secret"});
        let clear =
            serde_json::from_value::<T>(invoke.get("clear").cloned().unwrap_or(Value::Null))
                .expect("missing-key invoke shape must deserialize");
        RequestBody::TranscriptionSecretSet {
            secret: SecretWire::new("test-transcription-secret".to_string()),
            clear: clear.wire_value(),
        }
    }

    let request = body_json(request_from_missing_clear(transcription_secret_set));
    assert_eq!(
        request,
        serde_json::json!({
            "method": "transcription.secret_set",
            "secret": "test-transcription-secret",
            "clear": false
        }),
        "an omitted JS clear argument must serialize in the canonical default-false wire form"
    );
}

#[test]
fn all_new_optional_wire_arguments_are_omitted_when_absent() {
    let branch = body_json(RequestBody::BranchCreate {
        command_id: "command-1".to_string(),
        session_id: "session-1".to_string(),
        worker_generation: 1,
        source_branch_id: None,
        fork_node_id: "node-1".to_string(),
        fork_seq: 1,
        name: None,
    });
    for key in ["source_branch_id", "name"] {
        assert!(branch.get(key).is_none(), "{key} must be omitted");
    }

    let fork = body_json(RequestBody::SessionFork {
        command_id: "command-2".to_string(),
        session_id: "session-1".to_string(),
        worker_generation: 1,
        source_branch_id: None,
        fork_node_id: Some("node-1".to_string()),
        fork_seq: Some(1),
        prompt: None,
    });
    assert!(fork.get("source_branch_id").is_none());
    assert!(fork.get("prompt").is_none());

    let attach = body_json(RequestBody::SessionAttach {
        session_id: "session-1".to_string(),
        after_seq: 0,
        mode: AttachMode::Control,
        sealed_replay: None,
    });
    assert!(attach.get("sealed_replay").is_none());

    let headless = body_json(RequestBody::HeadlessRunStart {
        command_id: "command-3".to_string(),
        session_id: "session-1".to_string(),
        worker_generation: 1,
        text: "hello".to_string(),
        attachments: None,
        spec: serde_json::json!({"future": {"opaque": true}}),
        trust_hooks: false,
    });
    assert!(headless.get("attachments").is_none());

    let budget = serde_json::to_value(RunBudgetV1::default()).expect("empty budget serializes");
    assert_eq!(budget, serde_json::json!({}));
}

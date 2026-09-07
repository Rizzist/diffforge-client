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
    for key in [
        "permission_overrides",
        "cache_policy",
        "interaction_mode",
        "ssh_scope",
    ] {
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

/// Exercise the production actor's last gate before write_frame, using a real
/// socket pair so a missing gate cannot pass by only returning expected bits.
#[cfg(unix)]
async fn create_through_actor(
    policy: Option<Value>,
    ssh_scope: Option<SshScopeV1>,
    advertised: BTreeSet<String>,
) -> Result<Value, SessionCreateCommandErrorV1> {
    let (body, features) = session_create_request_with_admission(
        "/work".to_string(),
        "openai".to_string(),
        "gpt-5".to_string(),
        4096,
        policy,
        None,
        None,
        None,
        ssh_scope,
    )
    .expect("build create request");
    lifecycle_request_through_actor(body, features, advertised)
        .await
        .map_err(SessionCreateCommandErrorV1::from)
}

#[cfg(unix)]
async fn lifecycle_request_through_actor(
    body: RequestBody,
    features: BTreeSet<String>,
    advertised: BTreeSet<String>,
) -> Result<Value, LifecycleCommandError> {
    let expected_body = request_json(body.clone());
    let (mut client, mut server) = UnixStream::pair().expect("lifecycle socket pair");
    let connection = ConnectionSnapshot {
        connected: true,
        features: advertised,
        capabilities_granted: BTreeSet::from([Capability::Control]),
        frame_limit: DEFAULT_FRAME_LIMIT,
        ..Default::default()
    };
    let (reply, mut answer) = oneshot::channel();
    let mut pending = HashMap::new();
    let mut next_request = 0;
    let (watch_tx, _) = watch::channel(AccountRosterWatchState::default());
    assert!(
        apply_connected_command(
            ActorCommand::RpcRequest {
                body,
                capability: Capability::Control,
                features: FeatureGate::all(features),
                error_style: RpcErrorStyle::Passthrough,
                reply,
            },
            &mut client,
            &connection,
            WireEncoding::Json,
            &mut HashMap::new(),
            &mut HashMap::new(),
            &mut None,
            &mut None,
            &mut None,
            &mut None,
            &mut pending,
            &mut HashMap::new(),
            &mut HashMap::new(),
            &mut HashMap::new(),
            &mut DescendantForwarders::new(),
            &mut HashMap::new(),
            &mut None,
            &mut Vec::new(),
            &mut next_request,
            &watch_tx,
        )
        .await
    );

    if let Ok(result) = answer.try_recv() {
        let error = result
            .expect("actor stays connected")
            .expect_err("local refusal");
        assert!(
            pending.is_empty(),
            "refused request must not await a receipt"
        );
        assert_eq!(next_request, 0, "refusal must not allocate a wire request");
        let error_kind = server
            .try_read(&mut [0; 1])
            .expect_err("refused request wrote bytes")
            .kind();
        assert_eq!(error_kind, std::io::ErrorKind::WouldBlock);
        return Err(lifecycle_transport_error(error));
    }

    assert_eq!(
        pending.len(),
        1,
        "sent request must await the daemon receipt"
    );
    let frame = tokio::time::timeout(
        Duration::from_secs(1),
        read_frame(&mut server, DEFAULT_FRAME_LIMIT),
    )
    .await
    .expect("lifecycle frame timeout")
    .expect("read actual lifecycle frame");
    let WireFrame::Request { request_id, body } = frame else {
        panic!("expected a lifecycle request on the wire");
    };
    assert!(
        pending.contains_key(&request_id),
        "correlation identity must match the wire"
    );
    let body = request_json(body);
    assert_eq!(
        body, expected_body,
        "actor must preserve all request fields exactly"
    );
    Ok(body)
}

#[cfg(unix)]
fn create_policy_peer(read_only: bool) -> BTreeSet<String> {
    let mut features = BTreeSet::from([
        "session_mutation_v1".to_string(),
        "session_permission_overrides_v1".to_string(),
    ]);
    if read_only {
        features.insert("session_read_only_v1".to_string());
    }
    features
}

#[cfg(unix)]
fn headless_policy_cases() -> Vec<(&'static str, &'static str, Value)> {
    vec![
        (
            "read_only_true",
            "session_read_only_v1",
            serde_json::json!({
                "permission_overrides": {"read_only": true, "allow_exec": true}
            }),
        ),
        (
            "read_only_false",
            "session_read_only_v1",
            serde_json::json!({
                "permission_overrides": {"read_only": false}
            }),
        ),
        (
            "read_only_null",
            "session_read_only_v1",
            serde_json::json!({
                "permission_overrides": {"read_only": null}
            }),
        ),
        (
            "agent_spawn",
            "agent_cli_v1",
            serde_json::json!({
                "agent_spawn": {"task": "inspect", "prompt": "opaque operator prompt",
                    "workflow": "future-workflow", "future": {"keep": 7}}
            }),
        ),
        (
            "request_budget",
            "request_budget_v1",
            serde_json::json!({
                "budget": {"request_budget": {"tranche": 3, "hard_cap": 7}}
            }),
        ),
        (
            "continuation_of",
            "request_budget_v1",
            serde_json::json!({
                "continuation_of": "run-authoritative-checkpoint"
            }),
        ),
    ]
}

#[cfg(unix)]
async fn headless_through_actor(
    spec: Value,
    advertised: BTreeSet<String>,
) -> Result<Value, LifecycleCommandError> {
    let (features, trust_hooks) = headless_spec_features(&spec)?;
    lifecycle_request_through_actor(
        headless_run_start_request(
            &attachment(),
            "ordinary text".to_string(),
            None,
            spec,
            trust_hooks,
        ),
        features,
        advertised,
    )
    .await
}

#[cfg(unix)]
async fn assert_headless_pin_gate(pin_prefix: &str) {
    for (pin, feature, spec) in headless_policy_cases()
        .into_iter()
        .filter(|(pin, _, _)| pin.starts_with(pin_prefix))
    {
        // Other new bits cannot stand in for this pin's published bit.
        let mut peer = BTreeSet::from([
            "headless_run_v1".to_string(),
            "run_budget_v1".to_string(),
            "session_read_only_v1".to_string(),
            "agent_cli_v1".to_string(),
            "request_budget_v1".to_string(),
        ]);
        peer.remove(feature);
        let error = headless_through_actor(spec.clone(), peer)
            .await
            .expect_err("unnegotiated pin must not write a request");
        assert_eq!(
            serde_json::to_value(&error).expect("typed rejection"),
            serde_json::json!({
                "code": "missing_feature",
                "message": format!("missing_feature: daemon does not advertise {feature}"),
                "retryable": false,
            }),
            "{pin}"
        );

        // Only the relevant new bit is present on the accepting peer.
        let peer = BTreeSet::from([
            "headless_run_v1".to_string(),
            "run_budget_v1".to_string(),
            feature.to_string(),
        ]);
        let wire = headless_through_actor(spec.clone(), peer)
            .await
            .expect("negotiated pin");
        assert_eq!(wire["spec"], spec, "{pin} was rewritten");
        assert_eq!(wire["session_id"], "provider-session-authority");
        assert_eq!(wire["worker_generation"], 41);
        assert_eq!(wire["text"], "ordinary text");
        assert!(wire.get("attachments").is_none());
    }
}

#[cfg(unix)]
#[tokio::test]
async fn lifecycle_headless_read_only_gate_rejects_and_forwards_exactly() {
    assert_headless_pin_gate("read_only").await;
}

#[cfg(unix)]
#[tokio::test]
async fn lifecycle_headless_agent_spawn_gate_rejects_and_forwards_exactly() {
    assert_headless_pin_gate("agent_spawn").await;
}

#[cfg(unix)]
#[tokio::test]
async fn lifecycle_headless_request_budget_gate_rejects_and_forwards_exactly() {
    assert_headless_pin_gate("request_budget").await;
}

#[cfg(unix)]
#[tokio::test]
async fn lifecycle_headless_continuation_of_gate_rejects_and_forwards_exactly() {
    assert_headless_pin_gate("continuation_of").await;
}

#[cfg(unix)]
#[tokio::test]
async fn lifecycle_headless_combined_pins_still_require_each_independent_feature() {
    let spec = serde_json::json!({
        "permission_overrides": {"read_only": false},
        "agent_spawn": {"task": "inspect", "prompt": "inspect"},
        "budget": {"request_budget": {"tranche": 2, "hard_cap": 4}, "max_tokens": 40},
        "continuation_of": "run-checkpoint"
    });
    let all = BTreeSet::from([
        "headless_run_v1".to_string(),
        "run_budget_v1".to_string(),
        "session_read_only_v1".to_string(),
        "agent_cli_v1".to_string(),
        "request_budget_v1".to_string(),
    ]);
    for bit in &all {
        let mut peer = all.clone();
        peer.remove(bit);
        let error = headless_through_actor(spec.clone(), peer)
            .await
            .expect_err("missing bit");
        assert_eq!(error.code, "missing_feature");
        assert_eq!(
            error.message,
            format!("missing_feature: daemon does not advertise {bit}")
        );
    }
    assert_eq!(
        headless_through_actor(spec.clone(), all)
            .await
            .expect("all negotiated")["spec"],
        spec
    );
}

#[cfg(unix)]
#[tokio::test]
async fn lifecycle_headless_legacy_specs_have_no_new_gates_or_defaults() {
    for spec in [
        serde_json::json!({"provider": "provider", "model": "model", "max_output_tokens": 4096}),
        serde_json::json!({"permission_overrides": {"allow_writes": false}, "budget": {}}),
        serde_json::json!({"budget": {"max_tokens": 123, "max_cost_microusd": 456, "max_time_ms": 789},
            "request_deadline_unix_ms": 1900000000000_u64, "replay_of": "old-run", "future": [1, null]}),
    ] {
        let mut legacy = lifecycle_features("headless_run_v1");
        if spec.get("budget").is_some() {
            legacy.insert("run_budget_v1".to_string());
        }
        assert_eq!(headless_spec_features(&spec).expect("old spec").0, legacy);
        let wire = headless_through_actor(spec.clone(), legacy)
            .await
            .expect("ordinary start needs no task/prompt pin");
        assert_eq!(wire["spec"], spec);
    }
    fn accepts_optional_attachments<Fut>(_: fn(String, String, Option<Vec<Value>>, Value) -> Fut) {}
    accepts_optional_attachments(headless_run_start);
}

#[cfg(unix)]
#[tokio::test]
async fn lifecycle_headless_agent_task_and_prompt_are_required_only_inside_the_pin() {
    for spawn in [
        serde_json::json!({}),
        serde_json::json!({"task": "task"}),
        serde_json::json!({"prompt": "prompt"}),
        serde_json::json!({"task": 3, "prompt": "prompt"}),
    ] {
        let error =
            headless_through_actor(serde_json::json!({"agent_spawn": spawn}), BTreeSet::new())
                .await
                .expect_err("invalid operator pin");
        assert_eq!(error.code, "invalid_argument");
    }
    assert!(headless_spec_features(&serde_json::json!({})).is_ok());
}

#[cfg(unix)]
#[tokio::test]
#[ignore = "requires the already-running 969 fixture; only View status requests, never starts headless work"]
async fn lifecycle_headless_live_969_pins_reject_at_the_production_gate() {
    let mut connection = actor_handle().connection.subscribe();
    tokio::time::timeout(Duration::from_secs(10), async {
        while !connection.borrow().connected {
            connection.changed().await.expect("live actor connection");
        }
    })
    .await
    .expect("live daemon connection timeout");
    let snapshot = connection.borrow().clone();
    assert_eq!(snapshot.daemon_version.as_deref(), Some("0.0.969"));
    assert!(snapshot.features.contains("headless_run_v1"));
    assert!(snapshot.features.contains("run_budget_v1"));
    for (pin, feature, spec) in headless_policy_cases() {
        assert!(
            !snapshot.features.contains(feature),
            "negative fixture changed: {feature}"
        );
        let (features, _) = headless_spec_features(&spec).expect("valid pin");
        // No published dry-run start exists. Exercise the same negotiated
        // transport gate with a View body, making a test regression harmless.
        let error = headless_request(
            headless_run_status_request("w8-2-negative-gate-no-run".to_string()),
            Capability::View,
            &features,
        )
        .await
        .expect_err("live 969 must reject the missing bit locally");
        assert_eq!(error.code, "missing_feature");
        assert!(!error.retryable);
        assert_eq!(
            error.message,
            format!("missing_feature: daemon does not advertise {feature}")
        );
        println!(
            "LIVE daemon=0.0.969 pin={pin} feature={feature} rejection={}",
            serde_json::to_string(&error).expect("typed error")
        );
    }
}

#[cfg(unix)]
#[tokio::test]
async fn lifecycle_create_explicit_read_only_requires_its_own_bit_before_wire() {
    for value in [
        serde_json::json!(true),
        serde_json::json!(false),
        Value::Null,
    ] {
        let error = create_through_actor(
            Some(serde_json::json!({"read_only": value, "allow_exec": true})),
            None,
            create_policy_peer(false),
        )
        .await
        .expect_err("explicit read_only must never reach a legacy peer");
        assert_eq!(
            serde_json::to_value(&error).expect("typed create error"),
            serde_json::json!({
                "code": "unavailable",
                "message": "missing_feature: daemon does not advertise session_read_only_v1",
                "retryable": false
            })
        );
    }
}

#[cfg(unix)]
#[tokio::test]
async fn lifecycle_create_read_only_values_cross_exactly_when_advertised() {
    for value in [true, false] {
        let policy =
            serde_json::json!({"read_only": value, "allow_exec": true, "future": {"keep": 7}});
        let wire = create_through_actor(Some(policy.clone()), None, create_policy_peer(true))
            .await
            .expect("negotiated read_only create");
        assert_eq!(wire["permission_overrides"], policy);
        assert!(wire.get("ssh_scope").is_none());
    }
}

#[cfg(unix)]
#[tokio::test]
async fn lifecycle_create_omitted_read_only_stays_absent_regardless_of_bit() {
    for bit in [false, true] {
        for policy in [
            None,
            Some(serde_json::json!({"allow_writes": false})),
            Some(serde_json::json!({})),
        ] {
            let wire = create_through_actor(policy.clone(), None, create_policy_peer(bit))
                .await
                .expect("omitted read_only create");
            assert_eq!(wire.get("permission_overrides"), policy.as_ref());
            assert!(wire
                .get("permission_overrides")
                .and_then(|p| p.get("read_only"))
                .is_none());
            assert!(wire.get("ssh_scope").is_none());
        }
    }
}

#[cfg(unix)]
#[tokio::test]
async fn lifecycle_create_ssh_scope_is_optional_exact_and_feature_gated() {
    for scope in [
        None,
        Some(SshScopeV1::All),
        Some(SshScopeV1::None),
        Some(SshScopeV1::Allow {
            names: vec!["  opaque-profile  ".to_string(), "other".to_string()],
        }),
    ] {
        let expected = scope
            .as_ref()
            .map(|s| serde_json::to_value(s).expect("scope JSON"));
        for advertised in [false, true] {
            let mut features = lifecycle_features("session_mutation_v1");
            if advertised {
                features.insert("ssh_profiles_v1".to_string());
            }
            let result = create_through_actor(None, scope.clone(), features).await;
            if scope.is_some() && !advertised {
                let error = result.expect_err("explicit scope requires the published SSH bit");
                assert_eq!(error.code, "unavailable");
                assert_eq!(
                    error.message,
                    "missing_feature: daemon does not advertise ssh_profiles_v1"
                );
            } else {
                let wire = result.expect("omitted or negotiated create scope");
                assert_eq!(wire.get("ssh_scope"), expected.as_ref());
            }
        }
    }

    fn accepts_command_optionals<Fut>(
        _: fn(
            String,
            String,
            String,
            u64,
            Option<Value>,
            Option<Value>,
            Option<String>,
            Option<SessionCreateAdmissionV1>,
            Option<SshScopeV1>,
        ) -> Fut,
    ) {
    }
    accepts_command_optionals(lifecycle_session_create_command);
}

#[cfg(unix)]
#[tokio::test]
#[ignore = "requires the already-running 969 negative fixture; never starts/stops a daemon or creates a session"]
async fn lifecycle_create_live_969_read_only_rejects_with_typed_absence() {
    let mut connection = actor_handle().connection.subscribe();
    tokio::time::timeout(Duration::from_secs(10), async {
        while !connection.borrow().connected {
            connection.changed().await.expect("live actor connection");
        }
    })
    .await
    .expect("live daemon connection timeout");
    let snapshot = connection.borrow().clone();
    assert_eq!(snapshot.daemon_version.as_deref(), Some("0.0.969"));
    assert!(snapshot
        .features
        .contains("session_permission_overrides_v1"));
    assert!(!snapshot.features.contains("session_read_only_v1"));
    println!("LIVE daemon_version=0.0.969 session_permission_overrides_v1=true session_read_only_v1=false");
    for value in [true, false] {
        let error = lifecycle_session_create_command(
            std::env::current_dir().expect("cwd").display().to_string(),
            "openai".to_string(),
            "gpt-5".to_string(),
            4096,
            Some(serde_json::json!({"read_only": value})),
            None,
            None,
            None,
            None,
        )
        .await
        .expect_err("live legacy daemon must never receive this create");
        println!(
            "LIVE read_only={value} rejection={}",
            serde_json::to_string(&error).expect("typed JSON")
        );
        assert_eq!(error.code, "unavailable");
        assert_eq!(
            error.message,
            "missing_feature: daemon does not advertise session_read_only_v1"
        );
    }
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

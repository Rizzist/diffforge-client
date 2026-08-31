#![allow(clippy::expect_used)]

use super::*;

fn shell_value(status: Value) -> Value {
    serde_json::json!({
        "id": "sh-0123456789abcdef0123",
        "kind": {"kind": "ssh", "profile": "prod", "future_kind": true},
        "status": status,
        "title": "prod: tests",
        "cwd_or_host": "prod.example.invalid",
        "created_at_ms": 1_787_155_782_065_u64,
        "last_activity_ms": 1_787_155_782_099_u64,
        "bytes_out": 9_007_199_254_740_999_u64,
        "future_shell_field": {"kept": [null, true, 7]}
    })
}

fn public_profile_value() -> Value {
    serde_json::json!({
        "name": "prod",
        "description": "Production",
        "host": "prod.example.invalid",
        "port": 22,
        "user": "deploy",
        "default_cwd": "/srv/app",
        "host_key": {
            "algorithm": "ssh-ed25519",
            "fingerprint": "SHA256:fixture",
            "pinned_at_ms": 1_787_155_782_000_u64,
            "future_host_key_field": true
        },
        "last_used_ms": 1_787_155_782_100_u64,
        "multiplexing": true,
        "in_scope": false,
        "future_public_field": {"kept": true}
    })
}

fn profile() -> SshProfileRecordV1 {
    SshProfileRecordV1::from_value(public_profile_value()).expect("public SSH profile")
}

fn request_json(body: RequestBody) -> Value {
    serde_json::to_value(body).expect("serialize request")
}

#[test]
fn shell_output_is_connection_transient_and_gap_is_unrecoverable() {
    assert_eq!(
        ShellOutputDeliveryV1::ConnectionTransient,
        ShellOutputDeliveryV1::ConnectionTransient
    );
    assert_eq!(
        ShellOutputGapV1::Unrecoverable,
        ShellOutputGapV1::Unrecoverable
    );
    assert!(
        !SHELL_OUTPUT_REPLAYABLE,
        "ShellOutput must never be represented as replayable"
    );

    let delivered_payload = serde_json::json!({
        "id": "sh-transient",
        "stream": "future_combined",
        "chunk_b64": "b25seS1kZWxpdmVyZWQ=",
        "future_output_field": {"kept": [1, 2, 3]}
    });
    let mut frame_value = delivered_payload.clone();
    frame_value["kind"] = serde_json::json!("shell.output");
    let frame: WireFrame = serde_json::from_value(frame_value).expect("decode ShellOutput");
    let event = shell_event_from_frame(frame).expect("project ShellOutput");
    assert_eq!(event.name(), SHELL_OUTPUT_EVENT);
    let ShellWebviewEventV1::Output(payload) = event else {
        panic!("ShellOutput projected as a lifecycle event");
    };
    let forwarded = serde_json::to_value(payload).expect("serialize ShellOutput event payload");
    assert_eq!(forwarded, delivered_payload);
    for forbidden in ["cursor", "seq", "after_cursor", "replay", "synthesized"] {
        assert!(
            forwarded.get(forbidden).is_none(),
            "transient output must not grow recovery field {forbidden}: {forwarded}"
        );
    }

    let source = include_str!("haider_rpc_ade.rs");
    for required in [
        "CONNECTION-TRANSIENT",
        "not durable or replayable",
        "output gap is unrecoverable",
        "never synthesizes bytes",
    ] {
        assert!(
            source.contains(required),
            "ShellOutput type documentation must state `{required}`"
        );
    }
}

#[test]
fn shell_close_closed_row_is_idempotent_normal_outcome() {
    let body: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "shell.close",
        "shell": shell_value(serde_json::json!({"status": "closed"}))
    }))
    .expect("decode idempotent close response");
    let receipt = shell_close_response(body)
        .expect("an already-closed shell must be a normal idempotent result");
    assert!(matches!(
        receipt.shell.status,
        ShellStatusIdentityV1::Closed
    ));
    assert_eq!(
        serde_json::to_value(&receipt.shell).expect("serialize closed shell"),
        shell_value(serde_json::json!({"status": "closed"}))
    );

    let exited = ShellRecordV1::from_value(shell_value(serde_json::json!({
        "status": "exited",
        "code": 0
    })))
    .expect("decode naturally exited row");
    assert!(matches!(exited.status, ShellStatusIdentityV1::Exited));
    assert_eq!(exited.exit_code, Some(0));
    assert_ne!(exited.status, receipt.shell.status);
}

#[cfg(unix)]
#[test]
fn shell_exec_coordinates_are_attachment_owned_and_absent_run_id_stays_none() {
    fn accepts_only_user_args<Fut>(
        _: fn(String, Option<String>, Option<String>, String, Option<String>) -> Fut,
    ) {
    }
    accepts_only_user_args(shell_exec);

    let attachment = WorkflowControlAttachment {
        attachment_id: "attachment-authority".to_string(),
        session_id: "provider-session-authority".to_string(),
        worker_generation: 73,
        replay_through_seq: 99,
    };
    let request = request_json(shell_exec_request(
        &attachment,
        Some("branch-authority".to_string()),
        None,
        "printf exact".to_string(),
        None,
    ));
    assert_eq!(request["session_id"], "provider-session-authority");
    assert_eq!(request["worker_generation"], 73);
    assert!(request["command_id"]
        .as_str()
        .is_some_and(|command_id| command_id.starts_with("diffforge-shell-exec-")));
    assert_eq!(request["branch_id"], "branch-authority");
    assert!(request.get("agent_id").is_none());
    assert!(request.get("cwd").is_none());

    let response: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "shell.exec",
        "session_id": "provider-session-authority",
        "item_id": "item-shell-1",
        "accepted_seq": 9_007_199_254_740_999_u64,
        "worker_generation": 73
    }))
    .expect("decode old additive response without run_id");
    let receipt = shell_exec_response(response, &attachment).expect("accept shell.exec receipt");
    assert_eq!(
        receipt.run_id, None,
        "missing run_id must stay typed absence"
    );
    let public = serde_json::to_value(receipt).expect("serialize shell.exec receipt");
    assert_eq!(public["accepted_seq"], "9007199254740999");
    assert_eq!(public["worker_generation"], 73);
    assert!(public.get("run_id").is_none());

    assert_eq!(
        shell_exec_features(),
        BTreeSet::from([
            FEATURE_SHELL_EXEC_V1.to_string(),
            FEATURE_TURN_CONTROL_V1.to_string(),
            FEATURE_USER_COMMAND_V1.to_string(),
        ])
    );
}

#[test]
fn ssh_secret_input_is_daemon_only_and_no_result_error_or_debug_can_echo_it() {
    let canary = "stage-secret-never-crosses-back";
    let add = ssh_add_request(serde_json::json!({
        "name": "prod",
        "host": "prod.example.invalid",
        "user": "deploy",
        "auth": {"kind": "password", "vault_reference": canary}
    }))
    .expect("build secret-bearing add request");
    let add_wire = request_json(add.clone());
    assert_eq!(add_wire["profile"]["auth"]["vault_reference"], canary);
    assert!(!format!("{add:?}").contains(canary));

    let update = ssh_update_request(
        "prod".to_string(),
        serde_json::json!({
            "auth": {"kind": "key_material", "vault_reference": canary}
        }),
    )
    .expect("build secret-bearing update request");
    assert_eq!(
        request_json(update.clone())["changes"]["auth"]["vault_reference"],
        canary
    );
    assert!(!format!("{update:?}").contains(canary));

    let input = ssh_shell_input_request("sh-pty".to_string(), canary.to_string());
    assert_eq!(request_json(input.clone())["data_b64"], canary);
    assert!(!format!("{input:?}").contains(canary));

    let public = public_profile_value();
    let list: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "ssh.list",
        "profiles": [public.clone()]
    }))
    .expect("decode public list response");
    let list = ssh_list_response(list).expect("project public list response");
    let list_json = serde_json::to_value(list).expect("serialize public list receipt");

    let add: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "ssh.add",
        "profile": public.clone()
    }))
    .expect("decode public add response");
    let add_json = serde_json::to_value(ssh_add_response(add).expect("project add response"))
        .expect("serialize public add receipt");

    let update: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "ssh.update",
        "profile": public.clone()
    }))
    .expect("decode public update response");
    let update_json =
        serde_json::to_value(ssh_update_response(update).expect("project update response"))
            .expect("serialize public update receipt");

    let test: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "ssh.test",
        "result": {
            "profile": public,
            "connected": true,
            "host_key_pinned": true
        }
    }))
    .expect("decode public test response");
    let test_json = serde_json::to_value(ssh_test_response(test).expect("project test response"))
        .expect("serialize public test receipt");

    for receipt in [list_json, add_json, update_json, test_json] {
        let encoded = serde_json::to_string(&receipt).expect("encode public SSH receipt");
        for forbidden in [
            canary,
            "\"auth\"",
            "password",
            "private_key",
            "key_material",
            "passphrase",
            "vault_alias",
            "vault_reference",
            "\"path\"",
        ] {
            assert!(
                !encoded.contains(forbidden),
                "public SSH receipt leaked forbidden auth material `{forbidden}`: {encoded}"
            );
        }
    }

    let malicious = serde_json::json!({
        "name": "prod",
        "host": "prod.example.invalid",
        "port": 22,
        "user": "deploy",
        "multiplexing": true,
        "in_scope": true,
        "auth": {"kind": "password", "vault_reference": canary}
    });
    let rejection = SshProfileRecordV1::from_value(malicious)
        .expect_err("secret-bearing public profile must be rejected");
    assert!(!rejection.contains(canary));

    let error = ssh_response_error(
        ResponseBody::Error {
            code: "ssh_failure".to_string(),
            message: format!("daemon echoed {canary}"),
            retryable: false,
            data: Some(serde_json::json!({"vault_reference": canary})),
        },
        "unreachable mismatch",
    );
    let public_error = serde_json::to_string(&error).expect("serialize safe SSH error");
    assert!(!public_error.contains(canary));
    assert!(!format!("{error:?}").contains(canary));
}

#[test]
fn ssh_test_reachability_comes_only_from_published_connected_fact() {
    let unreachable = ssh_test_response(ResponseBody::SshTest {
        result: SshTestResultWireV1 {
            profile: profile(),
            connected: false,
            host_key_pinned: false,
        },
    })
    .expect("RPC success with a published unreachable result");
    assert!(matches!(
        unreachable.outcome,
        SshReachabilityV1::Unreachable
    ));

    let reachable = ssh_test_response(ResponseBody::SshTest {
        result: SshTestResultWireV1 {
            profile: profile(),
            connected: true,
            host_key_pinned: true,
        },
    })
    .expect("published reachable result");
    assert!(matches!(reachable.outcome, SshReachabilityV1::Reachable));

    assert!(ssh_test_response(ResponseBody::SshRemove {
        removed: "prod".to_string(),
    })
    .is_err());
}

#[test]
fn shell_and_ssh_every_optional_arg_is_option_and_omits_wire_key() {
    fn shell_exec_signature<Fut>(
        _: fn(String, Option<String>, Option<String>, String, Option<String>) -> Fut,
    ) {
    }
    fn ssh_list_signature<Fut>(_: fn(AppHandle, Option<String>) -> Fut) {}
    fn ssh_test_signature<Fut>(_: fn(AppHandle, String, Option<u32>) -> Fut) {}
    fn ssh_shell_signature<Fut>(
        _: fn(AppHandle, String, String, Option<String>, Option<u32>) -> Fut,
    ) {
    }
    fn ssh_open_signature<Fut>(_: fn(AppHandle, String, Option<String>, String, Value) -> Fut) {}
    shell_exec_signature(shell_exec);
    ssh_list_signature(ssh_list);
    ssh_test_signature(ssh_test);
    ssh_shell_signature(ssh_shell);
    ssh_open_signature(ssh_shell_open);

    #[cfg(unix)]
    {
        let attachment = WorkflowControlAttachment {
            attachment_id: "attachment".to_string(),
            session_id: "provider-session".to_string(),
            worker_generation: 7,
            replay_through_seq: 8,
        };
        let shell = request_json(shell_exec_request(
            &attachment,
            None,
            None,
            "true".to_string(),
            None,
        ));
        for key in ["branch_id", "agent_id", "cwd"] {
            assert!(
                shell.get(key).is_none(),
                "{key} serialized as null: {shell}"
            );
        }
    }

    let list = request_json(ssh_list_request(None));
    assert!(list.get("session_id").is_none());
    let test = request_json(ssh_test_request("prod".to_string(), None));
    assert!(test.get("timeout_s").is_none());
    let shell = request_json(ssh_shell_request(
        "prod".to_string(),
        "true".to_string(),
        None,
        None,
    ));
    assert!(shell.get("cwd").is_none());
    assert!(shell.get("timeout_s").is_none());
    let open = request_json(
        ssh_shell_open_request(
            "prod".to_string(),
            None,
            "xterm-256color".to_string(),
            serde_json::json!({"cols": 80, "rows": 24}),
        )
        .expect("build PTY open"),
    );
    assert!(open.get("session_id").is_none());
    assert!(open["size"].get("pixel_width").is_none());
    assert!(open["size"].get("pixel_height").is_none());

    let empty_changes = request_json(
        ssh_update_request("prod".to_string(), serde_json::json!({}))
            .expect("empty partial update"),
    );
    assert_eq!(empty_changes["changes"], serde_json::json!({}));

    let present_empty = request_json(ssh_shell_request(
        "prod".to_string(),
        "true".to_string(),
        Some(String::new()),
        Some(0),
    ));
    assert_eq!(present_empty["cwd"], "");
    assert_eq!(present_empty["timeout_s"], 0);
}

#[test]
fn shell_push_frames_forward_verbatim() {
    for (kind, event_name) in [
        ("shell.opened", SHELL_OPENED_EVENT),
        ("shell.state", SHELL_STATE_EVENT),
        ("shell.closed", SHELL_CLOSED_EVENT),
    ] {
        let payload = serde_json::json!({
            "shell": shell_value(serde_json::json!({
                "status": "future_suspended",
                "future_status_field": {"kept": true}
            })),
            "future_frame_payload": {"kept": [null, 9]}
        });
        let mut frame_value = payload.clone();
        frame_value["kind"] = serde_json::json!(kind);
        let event = shell_event_from_frame(
            serde_json::from_value(frame_value).expect("decode shell lifecycle push"),
        )
        .expect("project shell lifecycle push");
        assert_eq!(event.name(), event_name);
        let serialized = match event {
            ShellWebviewEventV1::Opened(payload)
            | ShellWebviewEventV1::State(payload)
            | ShellWebviewEventV1::Closed(payload) => {
                assert!(matches!(
                    payload.shell.status,
                    ShellStatusIdentityV1::Unknown(ref status) if status == "future_suspended"
                ));
                serde_json::to_value(payload).expect("serialize shell lifecycle payload")
            }
            ShellWebviewEventV1::Output(_) => panic!("lifecycle push projected as output"),
        };
        assert_eq!(serialized, payload);
    }

    let output_payload = serde_json::json!({
        "id": "sh-0123456789abcdef0123",
        "stream": "future_combined",
        "chunk_b64": "ZGVsaXZlcmVkLW9ubHk=",
        "future_output_field": {"kept": true}
    });
    let mut frame_value = output_payload.clone();
    frame_value["kind"] = serde_json::json!("shell.output");
    let event = shell_event_from_frame(
        serde_json::from_value(frame_value).expect("decode transient output push"),
    )
    .expect("project transient output push");
    assert_eq!(event.name(), SHELL_OUTPUT_EVENT);
    let ShellWebviewEventV1::Output(payload) = event else {
        panic!("output push projected as lifecycle");
    };
    assert!(matches!(
        &payload.stream,
        ShellOutputStreamV1::Unknown(stream) if stream == "future_combined"
    ));
    assert_eq!(
        serde_json::to_value(payload).expect("serialize transient output payload"),
        output_payload
    );
}

#[test]
fn shell_ssh_features_scope_unknowns_and_numbers_match_966() {
    assert_eq!(FEATURE_SHELL_EXEC_V1, "shell_exec_v1");
    assert_eq!(FEATURE_TURN_CONTROL_V1, "turn_control_v1");
    assert_eq!(FEATURE_USER_COMMAND_V1, "user_command_v1");
    assert_eq!(FEATURE_SSH_PROFILES_V1, "ssh_profiles_v1");
    assert_eq!(FEATURE_SHELL_REGISTRY_V1, "shell_registry_v1");
    assert_eq!(SHELL_OPENED_EVENT, "shell-opened");
    assert_eq!(SHELL_STATE_EVENT, "shell-state");
    assert_eq!(SHELL_CLOSED_EVENT, "shell-closed");
    assert_eq!(SHELL_OUTPUT_EVENT, "shell-output");

    let unknown: SshScopeV1 = serde_json::from_value(serde_json::json!({
        "kind": "future_workspace",
        "roots": ["prod"],
        "future": {"kept": true}
    }))
    .expect("decode unknown scope");
    assert!(matches!(unknown, SshScopeV1::Unknown(_)));
    assert_eq!(
        serde_json::to_value(unknown).expect("round-trip unknown scope"),
        serde_json::json!({
            "kind": "future_workspace",
            "roots": ["prod"],
            "future": {"kept": true}
        })
    );

    let shell = ShellRecordV1::from_value(shell_value(serde_json::json!({
        "status": "running"
    })))
    .expect("decode shell timestamp fixture");
    let public = serde_json::to_value(shell).expect("serialize shell timestamp fixture");
    assert!(public["created_at_ms"].is_number());
    assert!(public["last_activity_ms"].is_number());
    assert!(public["bytes_out"].is_number());

    let output = ShellWebviewEventV1::Output(ShellOutputEventPayloadV1 {
        id: "sh".to_string(),
        stream: ShellOutputStreamV1::Stdout,
        chunk_b64: TerminalOutputWireV1("Zml4dHVyZQ==".to_string()),
        extra: BTreeMap::new(),
    });
    assert!(!output.advertised_by(&BTreeSet::from([FEATURE_SHELL_REGISTRY_V1.to_string()])));
    assert!(output.advertised_by(&BTreeSet::from([FEATURE_SSH_PROFILES_V1.to_string()])));
}

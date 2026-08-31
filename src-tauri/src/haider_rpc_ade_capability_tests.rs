use super::*;

fn request_json(body: RequestBody) -> Value {
    serde_json::to_value(body).expect("serialize capability request")
}

fn response_body(value: Value) -> ResponseBody {
    serde_json::from_value(value).expect("decode capability response")
}

#[test]
fn capability_pin_1_cas_fences_are_transmitted_verbatim() {
    let configure_fence = u64::MAX - 4;
    let remove_fence = u64::MAX - 3;
    let trust_fence = u64::MAX - 2;

    let configure = request_json(provider_configure_request(
        "internal-configure".to_string(),
        "local".to_string(),
        None,
        None,
        None,
        true,
        Vec::new(),
        None,
        None,
        None,
        None,
        None,
        None,
        configure_fence,
    ));
    let remove = request_json(provider_remove_request(
        "internal-remove".to_string(),
        "local".to_string(),
        remove_fence,
    ));
    let trust = request_json(provider_set_trust_request(
        "internal-trust".to_string(),
        "local".to_string(),
        ProviderTrustV1::Lockdown,
        trust_fence,
    ));

    assert_eq!(
        configure["expected_revision"].as_u64(),
        Some(configure_fence)
    );
    assert_eq!(
        remove["expected_revision"].as_u64(),
        Some(remove_fence),
        "provider.remove must echo the exact read fence"
    );
    assert_eq!(trust["expected_revision"].as_u64(), Some(trust_fence));
}

#[test]
fn capability_pin_2_provider_revision_conflict_is_typed() {
    let error = provider_remove_response(response_body(serde_json::json!({
        "method": "error",
        "code": "revision_conflict",
        "message": "stale provider snapshot",
        "retryable": false,
        "data": {
            "kind": "revision_conflict",
            "expected_revision": 9007199254740993_u64,
            "current_revision": 9007199254740999_u64
        }
    })))
    .expect_err("stale provider mutation must reject");

    let Some(CapabilityErrorDataV1::RevisionConflict(conflict)) = error.data.as_ref() else {
        panic!("provider revision conflict was flattened or mistyped");
    };
    assert_eq!(conflict.expected_revision.0, 9_007_199_254_740_993);
    assert_eq!(conflict.current_revision.0, 9_007_199_254_740_999);
    let public = serde_json::to_value(error).expect("serialize structured rejection");
    assert_eq!(public["data"]["kind"], "revision_conflict");
    assert_eq!(public["data"]["expected_revision"], "9007199254740993");
    assert_eq!(public["data"]["current_revision"], "9007199254740999");
}

#[test]
fn capability_pin_3_hook_trust_is_digest_identified_and_fail_closed() {
    let digest = "sha256:DAEMON/Published+Digest==";
    let list = hooks_list_response(response_body(serde_json::json!({
        "method": "hooks.list",
        "policy": "workspace",
        "revision": 41,
        "hooks": [
            {
                "name": "future trust",
                "digest": digest,
                "source": "/daemon/hook.json",
                "kind": "command",
                "event": "before_turn",
                "trusted": true,
                "trust_state": "future_attested",
                "decision": false,
                "timeout_ms": 250
            },
            {
                "name": "legacy-looking trust",
                "digest": "sha256:legacy",
                "source": "/daemon/old.json",
                "kind": "command",
                "event": "after_turn",
                "trusted": true,
                "decision": false,
                "timeout_ms": 250
            }
        ]
    })))
    .expect("project hook list");

    assert!(matches!(
        list.hooks[0].trust_state,
        Some(HookTrustStateV1::Unknown(ref raw)) if raw == "future_attested"
    ));
    assert!(!list.hooks[0].trusted, "future hook trust was upgraded");
    assert!(list.hooks[1].trust_state.is_none());
    assert!(
        !list.hooks[1].trusted,
        "absent typed hook trust was upgraded from a legacy hint"
    );

    let trust = request_json(hooks_trust_request(
        "diffforge-hooks-trust-internal".to_string(),
        list.hooks[0].digest.clone(),
    ));
    let revoke = request_json(hooks_revoke_request(
        "diffforge-hooks-revoke-internal".to_string(),
        list.hooks[0].digest.clone(),
    ));
    assert_eq!(trust["digest"], digest, "daemon digest changed on trust");
    assert_eq!(revoke["digest"], digest, "daemon digest changed on revoke");
    assert_eq!(trust["command_id"], "diffforge-hooks-trust-internal");
    assert_eq!(revoke["command_id"], "diffforge-hooks-revoke-internal");
}

#[test]
fn capability_pin_4_hook_mode_and_kind_absence_stay_absent() {
    let list = hooks_list_response(response_body(serde_json::json!({
        "method": "hooks.list",
        "policy": "workspace",
        "revision": 9,
        "hooks": [{
            "name": "long-lived-server-hook",
            "digest": "sha256:no-mode",
            "source": "/daemon/hook.json",
            "event": "before_turn",
            "trusted": false,
            "trust_state": "untrusted",
            "decision": false,
            "timeout_ms": 0
        }]
    })))
    .expect("project hook with omitted classification");

    assert!(list.hooks[0].kind.is_none());
    let public = serde_json::to_value(&list.hooks[0]).expect("serialize hook summary");
    assert!(
        public.get("kind").is_none(),
        "absent hook kind was inferred"
    );
    assert!(
        public.get("mode").is_none(),
        "absent hook mode was inferred"
    );
}

#[test]
fn capability_pin_5_tool_input_schema_is_opaque() {
    let schema = serde_json::json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": ["object", "null"],
        "oneOf": [false, null, {"future_keyword": {"z": [3, 2, 1]}}],
        "required": ["same", "same"],
        "properties": {"raw": {"const": -0.0}}
    });
    let body = response_body(serde_json::json!({
        "method": "tools.inventory",
        "session_id": "session-provider-id",
        "inventory": {
            "tools": [{
                "manifest": {
                    "name": "future_tool",
                    "description": "opaque schema canary",
                    "effects": [{"class": "future_effect", "detail": 7}],
                    "dispatch": "future_dispatch",
                    "input_schema": schema.clone()
                },
                "default": "future_permission_default"
            }],
            "remembered_grants": [{
                "class": {"class": "network", "host": "EXAMPLE.invalid"},
                "scope": {"scope": "future_scope", "token": [1, null, false]}
            }]
        }
    }));
    let result = tools_inventory_response(body).expect("project tool inventory");
    assert_eq!(
        result.inventory.tools[0].manifest.input_schema, schema,
        "opaque tool schema was normalized"
    );
    assert_eq!(
        result.inventory.tools[0].default,
        "future_permission_default"
    );
    assert_eq!(
        result.inventory.remembered_grants[0].scope["scope"],
        "future_scope"
    );
    let public = serde_json::to_value(result).expect("serialize tool inventory");
    assert_eq!(
        public["inventory"]["tools"][0]["manifest"]["input_schema"],
        schema
    );
}

#[test]
fn capability_pin_6_unknown_provider_trust_and_lockdown_survive_raw() {
    let provider = provider_configure_response(response_body(serde_json::json!({
        "method": "provider.configure",
        "provider": {
            "provider": "future-provider",
            "api_family": "future_api",
            "models": [],
            "model_details": [],
            "auth_methods": [],
            "availability": "future_availability",
            "enabled": true,
            "trust": "future_restricted"
        },
        "revision": 17
    })))
    .expect("project provider result");
    assert!(
        matches!(
            provider.provider.trust,
            Some(ProviderTrustV1::Unknown(ref raw)) if raw == "future_restricted"
        ),
        "unknown security state became permissive"
    );
    assert!(!matches!(
        provider.provider.trust,
        Some(ProviderTrustV1::Full)
    ));
    let provider_json = serde_json::to_value(provider).expect("serialize provider result");
    assert_eq!(provider_json["provider"]["trust"], "future_restricted");

    let status = lockdown_status_response(response_body(serde_json::json!({
        "method": "lockdown.status",
        "status": {
            "provider": "future-provider",
            "activation": "future_isolated",
            "tools_allowed": [],
            "quota_used": 4,
            "quota_limit": 8
        }
    })))
    .expect("project lockdown status");
    assert!(
        matches!(
            status.activation,
            Some(LockdownActivationV1::Unknown(ref raw)) if raw == "future_isolated"
        ),
        "unknown lockdown activation lost its raw value"
    );
    assert_eq!(
        serde_json::to_value(&status).expect("serialize lockdown")["activation"],
        "future_isolated",
        "unknown security state became permissive"
    );

    let absent = lockdown_status_response(response_body(serde_json::json!({
        "method": "lockdown.status",
        "status": {"tools_allowed": [], "quota_used": 0, "quota_limit": 8}
    })))
    .expect("project global lockdown status");
    assert!(absent.activation.is_none());
    assert!(serde_json::to_value(absent)
        .expect("serialize absent activation")
        .get("activation")
        .is_none());
}

#[test]
fn capability_pin_7_every_optional_argument_omits_wire_key() {
    let configure = request_json(provider_configure_request(
        "internal-configure".to_string(),
        "local".to_string(),
        None,
        None,
        None,
        true,
        Vec::new(),
        None,
        None,
        None,
        None,
        None,
        None,
        12,
    ));
    for key in [
        "api_family",
        "origin",
        "auth_requirement",
        "default_model",
        "response_open_timeout_ms",
        "chunk_idle_timeout_ms",
        "semantic_progress_timeout_ms",
        "probe_vault_reference",
        "trust",
    ] {
        assert!(
            configure.get(key).is_none(),
            "omitted optional {key} serialized as null"
        );
    }
    assert!(
        request_json(lockdown_status_request(None))
            .get("provider")
            .is_none(),
        "omitted optional provider serialized as null"
    );

    fn hooks_mutation_signature<Fut>(_: fn(String) -> Fut) {}
    fn lockdown_status_signature<Fut>(_: fn(Option<String>) -> Fut) {}
    fn provider_remove_signature<Fut>(_: fn(String, CapabilityRevisionV1) -> Fut) {}
    fn provider_set_trust_signature<Fut>(
        _: fn(String, ProviderTrustV1, CapabilityRevisionV1) -> Fut,
    ) {
    }
    #[allow(clippy::type_complexity)]
    fn provider_configure_signature<Fut>(
        _: fn(
            String,
            Option<ProviderApiFamilyV1>,
            Option<String>,
            Option<ProviderAuthRequirementV1>,
            bool,
            Vec<String>,
            Option<String>,
            Option<u64>,
            Option<u64>,
            Option<u64>,
            Option<String>,
            Option<ProviderTrustV1>,
            CapabilityRevisionV1,
        ) -> Fut,
    ) {
    }

    hooks_mutation_signature(hooks_trust);
    hooks_mutation_signature(hooks_revoke);
    lockdown_status_signature(lockdown_status);
    provider_remove_signature(provider_remove);
    provider_set_trust_signature(provider_set_trust);
    provider_configure_signature(provider_configure);
}

#[test]
fn capability_commands_have_exact_features_and_internal_mutation_ids() {
    assert_eq!(FEATURE_TOOL_INVENTORY_V1, "tool_inventory_v1");
    assert_eq!(FEATURE_HOOKS_V1, "hooks_v1");
    assert_eq!(FEATURE_PROVIDER_CONFIGURE_V1, "provider_configure_v1");
    assert_eq!(FEATURE_PROVIDER_REMOVE_V1, "provider_remove_v1");
    assert_eq!(FEATURE_PROVIDER_LOCKDOWN_V1, "provider_lockdown_v1");
    assert_eq!(FEATURE_ACCOUNT_IDENTITY_V1, "account_identity_v1");

    for request in [
        hooks_trust_request("diffforge-hooks-trust-test".to_string(), "d".to_string()),
        hooks_revoke_request("diffforge-hooks-revoke-test".to_string(), "d".to_string()),
        provider_remove_request(
            "diffforge-provider-remove-test".to_string(),
            "p".to_string(),
            1,
        ),
        provider_set_trust_request(
            "diffforge-provider-set-trust-test".to_string(),
            "p".to_string(),
            ProviderTrustV1::Lockdown,
            1,
        ),
        lockdown_set_quota_request("diffforge-lockdown-set-quota-test".to_string(), 1),
    ] {
        assert!(request_json(request)["command_id"]
            .as_str()
            .is_some_and(|id| id.starts_with("diffforge-")));
    }
}

#[test]
fn capability_account_refresh_preserves_identity_and_timestamp_numbers() {
    let descriptor = serde_json::json!({
        "alias": "work",
        "provider": "openai",
        "auth_method": "oauth",
        "identity": "legacy display",
        "status": {"status": "active"},
        "active": true,
        "account_identity": {
            "email": "person@example.invalid",
            "captured_at": 1712345678901_u64,
            "verified": false,
            "future_identity_fact": {"kept": true}
        },
        "created_at_ms": 1712345678000_u64
    });
    let result = account_refresh_response(response_body(serde_json::json!({
        "method": "account.refresh",
        "descriptor": descriptor.clone(),
        "revision": 55
    })))
    .expect("project account refresh");
    assert_eq!(result.descriptor, descriptor);
    let public = serde_json::to_value(result).expect("serialize account refresh");
    assert!(public["descriptor"]["created_at_ms"].is_number());
    assert_eq!(public["revision"], "55");
}

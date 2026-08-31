#![allow(clippy::expect_used)]

use super::*;

const LARGE_CURSOR: u64 = 9_007_199_254_740_999;

fn registry_entry(id: &str, archived: bool) -> Value {
    serde_json::json!({
        "kind": "workflow",
        "id": id,
        "rev": 37,
        "digest": "daemon-digest-37",
        "archived": archived,
        "future_coordinate": {"retain": [1, 2, 3]}
    })
}

fn validation_error() -> Value {
    serde_json::json!({
        "code": "invalid_field",
        "message": "display prose is not a coordinate",
        "location": {
            "line": 7,
            "column": 13,
            "field": "nodes[2].depends_on"
        }
    })
}

#[test]
fn loom_p5_feature_constants_match_966_contract() {
    assert_eq!(FEATURE_LOOM_AUTHORING_V1, "loom_authoring_v1");
    assert_eq!(FEATURE_LOOM_REGISTRY_CAS_V1, "loom_registry_cas_v1");
    assert_eq!(FEATURE_LOOM_REGISTRY_ARCHIVE_V1, "loom_registry_archive_v1");
    assert_eq!(FEATURE_LOOM_VALIDATION_V1, "loom_validation_v1");
    assert_eq!(FEATURE_LOOM_REGISTRY_WATCH_V1, "loom_registry_watch_v1");
    assert_eq!(
        FEATURE_TYPED_AGENT_INSTALL_CANCEL_V1,
        "typed_agent_install_cancel_v1"
    );
}

#[test]
fn loom_p5_cas_fence_is_transmitted_verbatim() {
    let authoring_fence = u64::MAX - 11;
    let request = loom_author_revise_request(
        "authoring-7".to_string(),
        authoring_fence,
        LoomAuthorKind::Workflow,
        "{\"id\":\"review\"}".to_string(),
    );
    let encoded = serde_json::to_value(request).expect("encode exact authoring fence");
    assert_eq!(encoded["expected_revision"].as_u64(), Some(authoring_fence));

    let registry_fence = 4_000_000_001_u32;
    let digest = "digest-read-from-list".to_string();
    let request = RequestBody::LoomArchive {
        kind: LoomRegistryEntryKind::Workflow,
        id: "review".to_string(),
        expected_rev: registry_fence,
        expected_digest: Some(digest.clone()),
    };
    let encoded = serde_json::to_value(request).expect("encode exact registry fence");
    assert_eq!(
        encoded["expected_rev"].as_u64(),
        Some(u64::from(registry_fence))
    );
    assert_eq!(encoded["expected_digest"], digest);
}

#[test]
fn loom_p5_revision_conflict_remains_typed_with_expected_and_current() {
    let body: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "error",
        "code": "revision_conflict",
        "message": "registry head moved",
        "retryable": true,
        "data": {
            "kind": "loom_revision_conflict",
            "expected": {"rev": 37, "digest": "observed-37"},
            "current_rev": 38,
            "current_digest": "current-38"
        }
    }))
    .expect("decode Loom conflict response");
    let error = loom_archive_response(body).expect_err("stale CAS must reject archive");
    let Some(LoomErrorData::LoomRevisionConflict(conflict)) = error.data.as_ref() else {
        panic!("Loom conflict was flattened: {error:?}");
    };
    assert_eq!(conflict.expected.rev, 37);
    assert_eq!(conflict.expected.digest.as_deref(), Some("observed-37"));
    assert_eq!(conflict.current_rev, Some(38));
    assert_eq!(conflict.current_digest.as_deref(), Some("current-38"));
}

#[test]
fn loom_p5_confirmed_none_stays_none() {
    let body: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "loom.author.confirm",
        "errors": [validation_error()]
    }))
    .expect("decode validation-only confirmation");
    let result = loom_author_confirm_response(body).expect("project typed rejection outcome");

    assert_eq!(
        result.confirmed, None,
        "validation must not fabricate a receipt"
    );
    assert_eq!(result.errors.len(), 1);
    assert_eq!(result.errors[0].code, "invalid_field");
}

#[test]
fn loom_p5_validation_coordinates_remain_one_based_and_digest_is_only_preview() {
    let rejected: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "loom.validate",
        "errors": [validation_error()]
    }))
    .expect("decode validation errors");
    let rejected = loom_validate_response(rejected).expect("project validation errors");
    assert_eq!(rejected.errors[0].location.line, 7);
    assert_eq!(rejected.errors[0].location.column, 13);
    assert_eq!(rejected.errors[0].location.field, "nodes[2].depends_on");
    assert_eq!(rejected.canonical_digest, None);

    let accepted: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "loom.validate",
        "canonical_digest": "preview-not-a-stored-fence"
    }))
    .expect("decode validation preview");
    let accepted = loom_validate_response(accepted).expect("project validation preview");
    assert_eq!(
        accepted.canonical_digest.as_deref(),
        Some("preview-not-a-stored-fence")
    );
}

#[test]
fn loom_p5_archived_entries_require_explicit_inclusive_read() {
    let response = || {
        serde_json::from_value(serde_json::json!({
            "method": "loom.list",
            "agent_types": [],
            "workflows": [],
            "cli_present": {},
            "archived_entries": [registry_entry("archived-review", true)]
        }))
        .expect("decode archive-aware registry list")
    };

    let default = loom_list_response_for_request(response(), false).expect("default list");
    assert!(!default.include_archived);
    assert_eq!(
        default.archived_entries, None,
        "default inventory cannot prove archive absence or expose archive rows"
    );

    let inclusive = loom_list_response_for_request(response(), true).expect("inclusive list");
    assert!(inclusive.include_archived);
    assert_eq!(inclusive.archived_entries.as_ref().map(Vec::len), Some(1));

    let empty_inclusive: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "loom.list"
    }))
    .expect("decode omitted empty archive vector");
    let empty_inclusive =
        loom_list_response_for_request(empty_inclusive, true).expect("inclusive empty list");
    assert_eq!(empty_inclusive.archived_entries, Some(vec![]));
}

#[test]
fn loom_p5_watch_cursor_above_js_integer_limit_round_trips_as_decimal_string() {
    let parsed = parse_loom_watch_after_cursor(Some("9007199254740999"))
        .expect("checked parse large cursor");
    assert_eq!(parsed, LARGE_CURSOR);
    let wire = serde_json::to_value(RequestBody::LoomWatch {
        after_cursor: parsed,
    })
    .expect("encode daemon-facing cursor");
    assert_eq!(wire["after_cursor"].as_u64(), Some(LARGE_CURSOR));

    let result = LoomWatchResult {
        watch_id: "watch-9".to_string(),
        requested_after_cursor: LARGE_CURSOR,
        baseline: serde_json::json!({
            "through_cursor": LARGE_CURSOR,
            "entries": [{"entry": registry_entry("review", false), "record": {"opaque": true}}]
        }),
    };
    let tauri = serde_json::to_value(result).expect("encode Tauri watch response");
    assert_eq!(tauri["requested_after_cursor"], "9007199254740999");
    assert_eq!(tauri["baseline"]["through_cursor"], "9007199254740999");

    let delta = LoomRegistryDeltaEvent {
        watch_id: "watch-9".to_string(),
        delta: serde_json::json!({
            "cursor": LARGE_CURSOR,
            "change": "archived",
            "entry": registry_entry("review", true),
            "record": {"future": ["kept", 7]}
        }),
    };
    let delta = serde_json::to_value(delta).expect("encode pushed delta");
    assert_eq!(delta["delta"]["cursor"], "9007199254740999");
    assert_eq!(
        delta["delta"]["record"]["future"],
        serde_json::json!(["kept", 7])
    );

    let caught_up = serde_json::to_value(LoomRegistryCaughtUpEvent {
        watch_id: "watch-9".to_string(),
        high_water_cursor: LARGE_CURSOR,
    })
    .expect("encode caught-up cursor");
    assert_eq!(caught_up["high_water_cursor"], "9007199254740999");
}

#[test]
fn loom_p5_registry_push_frames_keep_watch_identity_and_payload() {
    let delta_raw = serde_json::json!({
        "cursor": LARGE_CURSOR,
        "change": "revision_added",
        "entry": registry_entry("review", false),
        "record": {
            "kind": "workflow",
            "record": {"id": "review", "future": {"opaque": true}}
        }
    });
    let frame: WireFrame = serde_json::from_value(serde_json::json!({
        "kind": "loom_registry_delta",
        "watch_id": "watch-9",
        "delta": delta_raw.clone()
    }))
    .expect("decode pushed registry delta");
    let WireFrame::LoomRegistryDelta { watch_id, delta } = frame else {
        panic!("expected Loom registry delta frame");
    };
    assert_eq!(watch_id, "watch-9");
    assert_eq!(delta, delta_raw);

    let caught_up: WireFrame = serde_json::from_value(serde_json::json!({
        "kind": "loom_registry_caught_up",
        "watch_id": "watch-9",
        "high_water_cursor": LARGE_CURSOR
    }))
    .expect("decode registry caught-up frame");
    assert!(matches!(
        caught_up,
        WireFrame::LoomRegistryCaughtUp {
            watch_id,
            high_water_cursor: LARGE_CURSOR
        } if watch_id == "watch-9"
    ));
}

#[test]
fn loom_p5_every_optional_request_argument_omits_its_wire_key() {
    let confirm = serde_json::to_value(RequestBody::LoomAuthorConfirm {
        authoring_id: "authoring-7".to_string(),
        expected_revision: 9,
        kind: LoomAuthorKind::AgentType,
        text: "{}".to_string(),
        expected_rev: None,
        expected_digest: None,
    })
    .expect("encode confirmation without optional CAS coordinates");
    assert!(confirm.get("expected_rev").is_none());
    assert!(confirm.get("expected_digest").is_none());

    let archive = serde_json::to_value(RequestBody::LoomArchive {
        kind: LoomRegistryEntryKind::Workflow,
        id: "missing".to_string(),
        expected_rev: 0,
        expected_digest: None,
    })
    .expect("encode archive without digest");
    assert!(archive.get("expected_digest").is_none());

    let registration = serde_json::to_value(RequestBody::LoomRegisterWorkflowCas {
        source: "review: reviewer".to_string(),
        expected_rev: None,
        expected_digest: None,
    })
    .expect("encode tolerant missing CAS fields");
    assert!(registration.get("expected_rev").is_none());
    assert!(registration.get("expected_digest").is_none());

    let list = serde_json::to_value(RequestBody::LoomList {
        include_archived: false,
    })
    .expect("encode default list");
    assert!(list.get("include_archived").is_none());
}

#[test]
fn loom_p5_existing_list_bytes_are_unchanged_when_additions_are_absent() {
    let request = serde_json::to_vec(&RequestBody::LoomList {
        include_archived: false,
    })
    .expect("encode legacy list request");
    assert_eq!(request, br#"{"method":"loom.list"}"#);

    let body: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "loom.list",
        "agent_types": [],
        "cli_present": {}
    }))
    .expect("decode legacy list response");
    let result = loom_list_response(body).expect("project legacy list response");
    let response = serde_json::to_vec(&result).expect("encode legacy list result");
    assert_eq!(response, br#"{"agent_types":[],"cli_present":{}}"#);
}

#[test]
fn loom_p5_archive_and_cancel_outcomes_are_typed_and_unknown_tolerant() {
    let changed_raw = serde_json::json!({
        "status": "changed",
        "entry": registry_entry("review", true)
    });
    let changed: LoomArchiveOutcome =
        serde_json::from_value(changed_raw.clone()).expect("decode changed archive receipt");
    let LoomArchiveOutcome::Changed { entry } = changed else {
        panic!("expected changed archive receipt");
    };
    assert_eq!(entry, registry_entry("review", true));

    let terminal: TypedAgentInstallCancelReceipt = serde_json::from_value(serde_json::json!({
        "install_job_id": "install-7",
        "outcome": {"status": "already_terminal", "state": "cancelled"}
    }))
    .expect("decode already-terminal cancellation");
    assert!(matches!(
        terminal.outcome,
        TypedAgentInstallCancelOutcome::AlreadyTerminal {
            state: TypedAgentInstallTerminalStateV1::Cancelled
        }
    ));

    let future = serde_json::json!({
        "status": "superseded",
        "replacement_job_id": "install-8",
        "future": {"retain": true}
    });
    let receipt: TypedAgentInstallCancelReceipt = serde_json::from_value(serde_json::json!({
        "install_job_id": "install-7",
        "outcome": future.clone()
    }))
    .expect("decode future cancellation outcome");
    assert!(matches!(
        &receipt.outcome,
        TypedAgentInstallCancelOutcome::Unknown { raw } if raw == &future
    ));
    assert_eq!(
        serde_json::to_value(receipt).expect("re-encode future cancel outcome")["outcome"],
        future
    );
}

#[test]
fn loom_p5_deep_authoring_records_remain_verbatim() {
    let draft = serde_json::json!({
        "authoring_id": "authoring-7",
        "revision": LARGE_CURSOR,
        "kind": "workflow",
        "text": "{\n  \"id\": \"review\"\n}",
        "errors": [validation_error()],
        "future": {"nested": [null, true, 37]}
    });
    let body: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "loom.author.draft",
        "draft": draft.clone()
    }))
    .expect("decode future-rich draft");
    let result = loom_author_draft_response(body).expect("project opaque draft");
    assert_eq!(result.draft, draft);
}

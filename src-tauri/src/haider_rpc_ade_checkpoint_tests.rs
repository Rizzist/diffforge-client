#![allow(clippy::expect_used)]

use super::*;

const ABOVE_JS_SAFE_INTEGER: u64 = 9_007_199_254_740_993;

fn attachment() -> WorkflowControlAttachment {
    WorkflowControlAttachment {
        attachment_id: "attachment-checkpoint".to_string(),
        session_id: "provider-session-authority".to_string(),
        worker_generation: 73,
        replay_through_seq: 101,
    }
}

fn request_json(request: RequestBody) -> Value {
    serde_json::to_value(request).expect("serialize checkpoint request")
}

fn recorded_json(seq: u64, kind: &str, origin: &str) -> Value {
    serde_json::json!({
        "checkpoint_id": "checkpoint-1",
        "session_id": "provider-session-authority",
        "branch_id": "branch-a",
        "run_id": "run-1",
        "effect_id": "effect-1",
        "call_id": "call-1",
        "seq": seq,
        "workspace_revision": seq.to_string(),
        "kind": kind,
        "origin": origin,
        "source_checkpoint_id": "checkpoint-source",
        "paths": [{
            "path": "src/main.rs",
            "pre_artifact": "artifact-before",
            "pre_digest": "digest-before",
            "post_digest": "digest-after",
            "truncated_reason": null
        }],
        "post_digest": "aggregate-after",
        "recorded_at_ms": seq
    })
}

fn list_response(next_cursor: Option<u64>) -> ResponseBody {
    let mut page = serde_json::json!({
        "checkpoints": [recorded_json(ABOVE_JS_SAFE_INTEGER, "edit", "tool")]
    });
    if let Some(next_cursor) = next_cursor {
        page["next_cursor"] = serde_json::json!(next_cursor);
    }
    serde_json::from_value(serde_json::json!({
        "method": "checkpoint.list",
        "page": page
    }))
    .expect("decode checkpoint.list response")
}

#[test]
fn checkpoint_feature_and_command_boundaries_match_contract() {
    assert_eq!(FEATURE_CHECKPOINT_V1, "checkpoint_v1");

    fn accepts_list_optionals<Fut>(
        _: fn(String, Option<String>, Option<CheckpointCursorV1>, u16) -> Fut,
    ) {
    }
    fn accepts_mutation_optionals<Fut>(_: fn(String, Option<String>, String) -> Fut) {}
    accepts_list_optionals(checkpoint_list);
    accepts_mutation_optionals(checkpoint_undo);
    accepts_mutation_optionals(checkpoint_redo);
    accepts_mutation_optionals(checkpoint_rollback_turn);
}

#[test]
fn checkpoint_cursor_and_sequences_above_2pow53_round_trip_as_exact_decimal_strings() {
    let page = checkpoint_list_response(list_response(Some(ABOVE_JS_SAFE_INTEGER)))
        .expect("project checkpoint list page");
    let encoded = serde_json::to_value(&page).expect("serialize Tauri checkpoint page");

    assert_eq!(encoded["checkpoints"][0]["seq"], "9007199254740993");
    assert_eq!(
        encoded["checkpoints"][0]["workspace_revision"],
        "9007199254740993"
    );
    assert_eq!(
        encoded["checkpoints"][0]["recorded_at_ms"],
        "9007199254740993"
    );
    assert_eq!(encoded["next_cursor"], "9007199254740993");

    let returned_cursor: CheckpointCursorV1 =
        serde_json::from_value(encoded["next_cursor"].clone())
            .expect("checked-parse exact Tauri cursor");
    let request = request_json(checkpoint_list_request(
        "provider-session-authority".to_string(),
        None,
        Some(returned_cursor),
        100,
    ));
    assert_eq!(
        request["cursor"],
        serde_json::json!(ABOVE_JS_SAFE_INTEGER),
        "the decimal Tauri cursor must checked-parse back to exact daemon u64"
    );
}

#[test]
fn checkpoint_cursor_rejects_non_decimal_or_numeric_tauri_values() {
    for invalid in [
        serde_json::json!(ABOVE_JS_SAFE_INTEGER),
        serde_json::json!(""),
        serde_json::json!("-1"),
        serde_json::json!("1.5"),
        serde_json::json!("18446744073709551616"),
    ] {
        serde_json::from_value::<CheckpointCursorV1>(invalid)
            .expect_err("invalid/non-string checkpoint cursor must be rejected");
    }
}

#[test]
fn checkpoint_next_cursor_none_is_end_and_distinct_from_present_cursor() {
    let end = checkpoint_list_response(list_response(None)).expect("project end page");
    let more = checkpoint_list_response(list_response(Some(41))).expect("project continued page");

    assert_eq!(end.next_cursor, None, "None is the explicit end-of-list");
    assert_eq!(more.next_cursor, Some(CheckpointCursorV1(41)));
    assert_ne!(end.next_cursor, more.next_cursor);

    let end_json = serde_json::to_value(end).expect("serialize end page");
    let more_json = serde_json::to_value(more).expect("serialize continued page");
    assert!(end_json.get("next_cursor").is_none());
    assert_eq!(more_json["next_cursor"], "41");
}

#[test]
fn checkpoint_conflict_decodes_typed_with_all_digest_options_preserved() {
    let error = checkpoint_undo_response(
        serde_json::from_value(serde_json::json!({
            "method": "error",
            "code": "checkpoint_conflict",
            "message": "message is not load-bearing",
            "retryable": false,
            "data": {
                "kind": "checkpoint_conflict",
                "conflict": {
                    "path": "src/main.rs",
                    "expected_digest": "expected-exact",
                    "current_digest": "current-exact"
                }
            }
        }))
        .expect("decode typed checkpoint conflict"),
    )
    .expect_err("conflict must not become a receipt");

    assert_eq!(error.code, "checkpoint_conflict");
    let encoded = serde_json::to_value(&error).expect("serialize typed conflict through Tauri");
    assert_eq!(encoded["data"]["kind"], "checkpoint_conflict");
    assert_eq!(encoded["data"]["conflict"]["path"], "src/main.rs");
    assert_eq!(
        encoded["data"]["conflict"]["expected_digest"],
        "expected-exact"
    );
    assert_eq!(
        encoded["data"]["conflict"]["current_digest"],
        "current-exact"
    );
    match error.data.expect("conflict data must remain typed") {
        CheckpointErrorDataV1::CheckpointConflict(conflict) => {
            assert_eq!(conflict.path, "src/main.rs");
            assert_eq!(conflict.expected_digest.as_deref(), Some("expected-exact"));
            assert_eq!(conflict.current_digest.as_deref(), Some("current-exact"));
        }
        other => panic!("checkpoint conflict was flattened or mistyped: {other:?}"),
    }

    let absent: CheckpointErrorDataV1 = serde_json::from_value(serde_json::json!({
        "kind": "checkpoint_conflict",
        "conflict": {"path": "new-file"}
    }))
    .expect("decode absent conflict digests");
    match absent {
        CheckpointErrorDataV1::CheckpointConflict(conflict) => {
            assert_eq!(conflict.expected_digest, None);
            assert_eq!(conflict.current_digest, None);
        }
        other => panic!("checkpoint conflict absence was mistyped: {other:?}"),
    }
}

#[test]
fn checkpoint_rollback_conflict_remains_atomic_typed_preflight_data() {
    let error = checkpoint_rollback_turn_response(
        serde_json::from_value(serde_json::json!({
            "method": "error",
            "code": "checkpoint_conflict",
            "message": "rollback preflight failed",
            "retryable": false,
            "data": {
                "kind": "checkpoint_rollback_conflict",
                "conflict": {
                    "verified": ["src/lib.rs"],
                    "conflicts": [{
                        "path": "src/main.rs",
                        "expected_digest": null,
                        "current_digest": "current"
                    }]
                }
            }
        }))
        .expect("decode typed rollback conflict"),
    )
    .expect_err("rollback conflict must not become a receipt");

    let encoded =
        serde_json::to_value(&error).expect("serialize typed rollback conflict through Tauri");
    assert_eq!(encoded["data"]["kind"], "checkpoint_rollback_conflict");
    assert_eq!(encoded["data"]["conflict"]["verified"][0], "src/lib.rs");
    assert_eq!(
        encoded["data"]["conflict"]["conflicts"][0]["path"],
        "src/main.rs"
    );
    assert_eq!(
        encoded["data"]["conflict"]["conflicts"][0]["current_digest"],
        "current"
    );
    match error.data.expect("rollback conflict data") {
        CheckpointErrorDataV1::CheckpointRollbackConflict(conflict) => {
            assert_eq!(conflict.verified, ["src/lib.rs"]);
            assert_eq!(conflict.conflicts[0].path, "src/main.rs");
            assert_eq!(conflict.conflicts[0].expected_digest, None);
            assert_eq!(
                conflict.conflicts[0].current_digest.as_deref(),
                Some("current")
            );
        }
        other => panic!("rollback conflict was flattened or mistyped: {other:?}"),
    }
}

#[test]
fn checkpoint_unknown_kind_and_origin_survive_raw() {
    let page = checkpoint_list_response(
        serde_json::from_value(serde_json::json!({
            "method": "checkpoint.list",
            "page": {
                "checkpoints": [recorded_json(
                    17,
                    "future_atomic_replace",
                    "future_reconciliation"
                )]
            }
        }))
        .expect("decode future checkpoint vocabulary"),
    )
    .expect("project future checkpoint vocabulary");

    assert!(matches!(
        &page.checkpoints[0].kind,
        CheckpointKindV1::Unknown(raw) if raw == "future_atomic_replace"
    ));
    assert!(matches!(
        &page.checkpoints[0].origin,
        CheckpointOriginV1::Unknown(raw) if raw == "future_reconciliation"
    ));
    let encoded = serde_json::to_value(page).expect("re-encode future checkpoint vocabulary");
    assert_eq!(encoded["checkpoints"][0]["kind"], "future_atomic_replace");
    assert_eq!(encoded["checkpoints"][0]["origin"], "future_reconciliation");
}

#[test]
fn checkpoint_mutation_coordinates_come_only_from_control_attachment() {
    let attachment = attachment();
    let requests = [
        request_json(checkpoint_undo_request(
            &attachment,
            None,
            "last".to_string(),
        )),
        request_json(checkpoint_redo_request(
            &attachment,
            None,
            "checkpoint-1".to_string(),
        )),
        request_json(checkpoint_rollback_turn_request(
            &attachment,
            None,
            "run-1".to_string(),
        )),
    ];
    let prefixes = [
        "diffforge-checkpoint-undo-",
        "diffforge-checkpoint-redo-",
        "diffforge-checkpoint-rollback-turn-",
    ];

    for (request, prefix) in requests.iter().zip(prefixes) {
        assert_eq!(request["session_id"], "provider-session-authority");
        assert_eq!(
            request["worker_generation"], 73,
            "worker_generation must come from fresh Control attachment: {request}"
        );
        assert!(
            request["command_id"]
                .as_str()
                .is_some_and(|command_id| command_id.starts_with(prefix)),
            "command_id must be minted inside the attachment-backed mutation path: {request}"
        );
    }
}

#[test]
fn checkpoint_every_optional_argument_omits_its_wire_key() {
    let requests = [
        request_json(checkpoint_list_request(
            "provider-session-authority".to_string(),
            None,
            None,
            100,
        )),
        request_json(checkpoint_undo_request(
            &attachment(),
            None,
            "last".to_string(),
        )),
        request_json(checkpoint_redo_request(
            &attachment(),
            None,
            "last".to_string(),
        )),
        request_json(checkpoint_rollback_turn_request(
            &attachment(),
            None,
            "run-1".to_string(),
        )),
    ];

    assert!(requests[0].get("cursor").is_none());
    for request in requests {
        assert!(
            request.get("branch_id").is_none(),
            "omitted branch_id must carry no wire key, not null: {request}"
        );
    }
}

#[test]
fn checkpoint_receipt_preserves_complete_record_and_decimal_generation() {
    let body: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "checkpoint.redo",
        "receipt": {
            "checkpoint": recorded_json(ABOVE_JS_SAFE_INTEGER, "redo", "redo"),
            "restored_checkpoint_ids": ["checkpoint-1", "checkpoint-2"],
            "worker_generation": ABOVE_JS_SAFE_INTEGER
        }
    }))
    .expect("decode checkpoint mutation receipt");
    let receipt = checkpoint_redo_response(body).expect("project checkpoint mutation receipt");
    let encoded = serde_json::to_value(receipt).expect("serialize Tauri checkpoint receipt");

    assert_eq!(encoded["worker_generation"], "9007199254740993");
    assert_eq!(encoded["checkpoint"]["seq"], "9007199254740993");
    assert_eq!(
        encoded["restored_checkpoint_ids"],
        serde_json::json!(["checkpoint-1", "checkpoint-2"])
    );
    assert_eq!(
        encoded["checkpoint"]["paths"][0]["pre_artifact"],
        "artifact-before"
    );
    assert_eq!(
        encoded["checkpoint"]["paths"][0]["pre_digest"],
        "digest-before"
    );
    assert_eq!(
        encoded["checkpoint"]["paths"][0]["post_digest"],
        "digest-after"
    );
    assert!(encoded["checkpoint"]["paths"][0]
        .get("truncated_reason")
        .is_none());
}

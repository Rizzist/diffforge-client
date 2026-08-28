#![allow(clippy::expect_used)]

use super::*;

const ABOVE_JS_SAFE_INTEGER: u64 = 9_007_199_254_740_993;

fn baseline_json() -> Value {
    serde_json::json!({
        "session_id": "session-root",
        "generated_at_ms": 1_800_000_000_000_u64,
        "fanout": {
            "requested_children": 9,
            "accepted_children": 4,
            "hard_limit": 6
        },
        "truncation": {
            "truncated": true,
            "streamed_children": 4,
            "omitted_children": 2,
            "count_complete": false
        },
        "roots": [{
            "session_id": "session-child-a",
            "agent_id": "agent-a",
            "child_run_id": "run-child-a",
            "parent_session_id": "session-root",
            "parent_run_id": "run-root",
            "depth": 1,
            "task": "preserve future lineage",
            "state": "future_quiescing",
            "requested_after_seq": ABOVE_JS_SAFE_INTEGER,
            "replay_through_seq": ABOVE_JS_SAFE_INTEGER + 1,
            "parent_anchors": {
                "spawn_seq": ABOVE_JS_SAFE_INTEGER - 1,
                "future_anchor": {"opaque": true}
            },
            "children": []
        }]
    })
}

fn attach_response_body() -> ResponseBody {
    serde_json::from_value(serde_json::json!({
        "method": "session.descendants.attach",
        "attachment_id": "desc-attachment-962",
        "baseline": baseline_json()
    }))
    .expect("decode descendant attach response")
}

#[test]
fn descendant_feature_request_and_event_names_match_962() {
    assert_eq!(
        FEATURE_SESSION_DESCENDANT_STREAM_V1,
        "session_descendant_stream_v1"
    );
    assert_eq!(SESSION_DESCENDANT_STREAM_EVENT, "session-descendant-stream");
    assert_eq!(SESSION_DESCENDANT_REPAIR_EVENT, "session-descendant-repair");
}

#[test]
fn descendant_replay_cursor_requires_both_identities_and_never_cross_applies() {
    let cursors = descendant_replay_cursors_wire(vec![
        DescendantReplayCursor {
            session_id: "session-child-a".to_string(),
            agent_id: "agent-a".to_string(),
            after_seq: "41".to_string(),
        },
        DescendantReplayCursor {
            session_id: "session-child-b".to_string(),
            agent_id: "agent-b".to_string(),
            after_seq: "73".to_string(),
        },
    ])
    .expect("parse independently scoped descendant cursors");

    assert_eq!(
        cursors,
        vec![
            DescendantReplayCursorWire {
                session_id: "session-child-a".to_string(),
                agent_id: "agent-a".to_string(),
                after_seq: 41,
            },
            DescendantReplayCursorWire {
                session_id: "session-child-b".to_string(),
                agent_id: "agent-b".to_string(),
                after_seq: 73,
            },
        ],
        "each after_seq must stay attached to its exact session+agent identity"
    );

    assert_eq!(
        serde_json::to_value(session_descendants_attach_request(
            "session-root".to_string(),
            cursors,
            9,
        ))
        .expect("encode descendant attach request"),
        serde_json::json!({
            "method": "session.descendants.attach",
            "session_id": "session-root",
            "cursors": [
                {"session_id": "session-child-a", "agent_id": "agent-a", "after_seq": 41},
                {"session_id": "session-child-b", "agent_id": "agent-b", "after_seq": 73}
            ],
            "max_children": 9
        })
    );

    assert!(
        serde_json::from_value::<DescendantReplayCursor>(serde_json::json!({
            "session_id": "session-child-a",
            "after_seq": "41"
        }))
        .is_err(),
        "dropping agent_id must fail at the Tauri input boundary"
    );
    assert!(descendant_replay_cursors_wire(vec![DescendantReplayCursor {
        session_id: "session-child-a".to_string(),
        agent_id: String::new(),
        after_seq: "41".to_string(),
    }])
    .is_err());
}

#[test]
fn descendant_sequences_above_2pow53_cross_tauri_as_checked_decimal_strings() {
    let decimal = ABOVE_JS_SAFE_INTEGER.to_string();
    assert_eq!(
        parse_descendant_after_seq(&decimal).expect("parse >2^53 descendant cursor"),
        ABOVE_JS_SAFE_INTEGER
    );
    let wire = descendant_replay_cursors_wire(vec![DescendantReplayCursor {
        session_id: "session-child-a".to_string(),
        agent_id: "agent-a".to_string(),
        after_seq: decimal.clone(),
    }])
    .expect("checked-parse Tauri cursor");
    let request = serde_json::to_value(session_descendants_attach_request(
        "session-root".to_string(),
        wire,
        4,
    ))
    .expect("encode daemon cursor");
    assert_eq!(
        request["cursors"][0]["after_seq"].as_u64(),
        Some(ABOVE_JS_SAFE_INTEGER),
        "only the daemon-facing wire uses a u64 JSON number"
    );

    let attachment = session_descendants_attach_response(
        attach_response_body(),
        "session-root",
        ABOVE_JS_SAFE_INTEGER,
    )
    .expect("project descendant attachment");
    let tauri = serde_json::to_value(attachment).expect("serialize attachment for Tauri");
    assert_eq!(tauri["lost_events_at_attach"], decimal);
    assert_eq!(
        tauri["baseline"]["roots"][0]["requested_after_seq"],
        ABOVE_JS_SAFE_INTEGER.to_string()
    );
    assert_eq!(
        tauri["baseline"]["roots"][0]["replay_through_seq"],
        (ABOVE_JS_SAFE_INTEGER + 1).to_string()
    );
    assert_eq!(
        tauri["baseline"]["roots"][0]["parent_anchors"]["spawn_seq"],
        (ABOVE_JS_SAFE_INTEGER - 1).to_string()
    );

    let event = serde_json::to_value(SessionDescendantStreamPayload {
        attachment_id: "desc-attachment-962".to_string(),
        event: serde_json::json!({
            "event": "child_caught_up",
            "session_id": "session-child-a",
            "agent_id": "agent-a",
            "high_water_seq": ABOVE_JS_SAFE_INTEGER
        }),
    })
    .expect("serialize descendant event for Tauri");
    assert_eq!(
        event["event"]["high_water_seq"],
        ABOVE_JS_SAFE_INTEGER.to_string()
    );

    for invalid in ["", "+1", "-1", "1.0", "18446744073709551616"] {
        assert!(
            parse_descendant_after_seq(invalid).is_err(),
            "invalid decimal cursor {invalid:?} must be rejected"
        );
    }
}

#[test]
fn descendant_fanout_keeps_requested_accepted_and_hard_limit_distinct() {
    let attachment = session_descendants_attach_response(attach_response_body(), "session-root", 0)
        .expect("project descendant fanout");
    assert_eq!(attachment.baseline.fanout.requested_children, 9);
    assert_eq!(attachment.baseline.fanout.accepted_children, 4);
    assert_eq!(attachment.baseline.fanout.hard_limit, 6);
    assert_ne!(
        attachment.baseline.fanout.requested_children, attachment.baseline.fanout.accepted_children,
        "accepted fanout is a negotiated fact, not the requested value"
    );
}

#[test]
fn descendant_truncation_preserves_incomplete_count_accounting() {
    let attachment = session_descendants_attach_response(attach_response_body(), "session-root", 0)
        .expect("project descendant truncation");
    let truncation = &attachment.baseline.truncation;
    assert!(truncation.truncated);
    assert_eq!(truncation.streamed_children, 4);
    assert_eq!(truncation.omitted_children, 2);
    assert!(
        !truncation.count_complete,
        "count_complete=false must survive; omitted_children is only a lower bound"
    );
    assert_eq!(
        serde_json::to_value(truncation).expect("serialize truncation"),
        serde_json::json!({
            "truncated": true,
            "streamed_children": 4,
            "omitted_children": 2,
            "count_complete": false
        })
    );
}

#[test]
fn descendant_terminal_repair_has_identities_and_makes_no_sequence_claim() {
    let frame: WireFrame = serde_json::from_value(serde_json::json!({
        "kind": "session_descendant_repair_required",
        "attachment_id": "desc-attachment-962",
        "children": [
            {"session_id": "session-child-a", "agent_id": "agent-a"},
            {"session_id": "session-child-b", "agent_id": "agent-b"}
        ]
    }))
    .expect("decode terminal descendant repair frame");
    let WireFrame::SessionDescendantRepairRequired {
        attachment_id,
        children,
    } = frame
    else {
        panic!("repair decoded as another wire frame");
    };
    let payload = serde_json::to_value(SessionDescendantRepairPayload {
        attachment_id,
        children,
    })
    .expect("serialize repair payload");
    assert_eq!(
        payload,
        serde_json::json!({
            "attachment_id": "desc-attachment-962",
            "children": [
                {"session_id": "session-child-a", "agent_id": "agent-a"},
                {"session_id": "session-child-b", "agent_id": "agent-b"}
            ]
        }),
        "terminal RepairRequired names affected children and nothing else"
    );
    let children = payload["children"]
        .as_array()
        .expect("repair children array");
    assert!(
        children.iter().all(|child| {
            child
                .as_object()
                .is_some_and(|fields| fields.keys().all(|field| !descendant_sequence_field(field)))
        }),
        "repair must never fabricate a sequence; the client reuses its own cursors"
    );
}

#[test]
fn descendant_unknown_change_kind_node_state_and_event_fields_survive_raw() {
    let attachment = session_descendants_attach_response(attach_response_body(), "session-root", 0)
        .expect("project raw descendant node");
    assert_eq!(
        attachment.baseline.roots[0]["state"], "future_quiescing",
        "unknown node state must remain the daemon's exact string"
    );
    assert_eq!(
        attachment.baseline.roots[0]["parent_anchors"]["future_anchor"],
        serde_json::json!({"opaque": true})
    );

    let raw_event = serde_json::json!({
        "event": "delta",
        "change": "future_reparented",
        "child": {
            "session_id": "session-child-a",
            "agent_id": "agent-a",
            "state": "future_quiescing",
            "requested_after_seq": ABOVE_JS_SAFE_INTEGER,
            "future_node_field": {"authority": "daemon"}
        },
        "future_event_field": ["kept", 7]
    });
    let frame: WireFrame = serde_json::from_value(serde_json::json!({
        "kind": "session_descendant_stream",
        "attachment_id": "desc-attachment-962",
        "event": raw_event.clone()
    }))
    .expect("decode raw descendant stream event");
    let WireFrame::SessionDescendantStream {
        attachment_id,
        event,
    } = frame
    else {
        panic!("stream decoded as another wire frame");
    };
    assert_eq!(
        event, raw_event,
        "wire decode must keep the complete raw event"
    );

    let tauri = serde_json::to_value(SessionDescendantStreamPayload {
        attachment_id,
        event,
    })
    .expect("serialize raw descendant stream payload");
    assert_eq!(tauri["event"]["change"], "future_reparented");
    assert_eq!(tauri["event"]["child"]["state"], "future_quiescing");
    assert_eq!(
        tauri["event"]["child"]["future_node_field"],
        serde_json::json!({"authority": "daemon"})
    );
    assert_eq!(
        tauri["event"]["future_event_field"],
        serde_json::json!(["kept", 7])
    );
    assert_eq!(
        tauri["event"]["child"]["requested_after_seq"],
        ABOVE_JS_SAFE_INTEGER.to_string(),
        "the intentional Tauri sequence conversion must not rewrite other raw fields"
    );
}

#[test]
fn descendant_attach_and_detach_validate_correlated_identity_echoes() {
    assert!(
        session_descendants_attach_response(attach_response_body(), "different-root", 0,).is_err()
    );
    assert!(session_descendants_detach_response(
        ResponseBody::SessionDetach {
            attachment_id: "different-attachment".to_string(),
        },
        "desc-attachment-962",
    )
    .is_err());
    assert!(session_descendants_detach_response(
        ResponseBody::SessionDetach {
            attachment_id: "desc-attachment-962".to_string(),
        },
        "desc-attachment-962",
    )
    .is_ok());
}

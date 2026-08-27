#![allow(clippy::expect_used)]

use super::*;

fn bounded_fleet_response_json() -> Value {
    serde_json::json!({
        "method": "session.fleet",
        "snapshot": {
            "session_id": "session-root",
            "generated_at_ms": 1234,
            "node_limit": 1,
            "depth_limit": 1,
            "roots": [{
                "agent_id": "agent-folded",
                "session_id": "session-child",
                "task": "inspect the authority boundary",
                "depth": 1,
                "parent_session_id": "session-root",
                "state": "live",
                "folded_children": 3,
                "children": []
            }],
            "rollup": {
                "node_count": 1,
                "states": {
                    "queued": 0,
                    "live": 1,
                    "waiting": 0,
                    "done": 0,
                    "failed": 0,
                    "cancelled": 0
                },
                "max_depth": 1,
                "metrics": {
                    "elapsed_ms": 234,
                    "tool_attempts": 2
                },
                "metrics_complete": false,
                "complete": false
            },
            "truncated": true
        }
    })
}

fn bounded_fleet_snapshot() -> SessionFleetSnapshot {
    let body: ResponseBody = serde_json::from_value(bounded_fleet_response_json())
        .expect("decode bounded session.fleet response");
    session_fleet_response(body).expect("project bounded session.fleet response")
}

#[test]
fn fleet_feature_constants_and_summary_lineage_match_authority() {
    assert_eq!(FEATURE_SESSION_FLEET_V1, "session_fleet_v1");
    assert_eq!(FEATURE_AGENT_MESSAGE_V1, "agent_message_v1");
    assert_eq!(FEATURE_SESSION_OBSERVE_BATCH_V1, "session_observe_batch_v1");
    assert_eq!(FEATURE_SESSION_LINEAGE_V1, "session_lineage_v1");

    let raw = serde_json::json!({
        "method": "session.list",
        "sessions": [{
            "session_id": "session-child",
            "head_seq": 9,
            "worker_generation": 4,
            "kind": "subagent",
            "parent_session_id": "session-root",
            "future_summary_field": {"opaque": true}
        }]
    });
    let body: ResponseBody =
        serde_json::from_value(raw.clone()).expect("decode lineage-aware session summary");
    let ResponseBody::SessionList { sessions, .. } = &body else {
        panic!("session.list decoded as a different method");
    };
    assert_eq!(sessions[0]["kind"], "subagent");
    assert_eq!(sessions[0]["parent_session_id"], "session-root");
    assert_eq!(
        serde_json::to_value(body).expect("re-encode raw session summary"),
        raw,
        "typed lineage rides the existing raw SessionSummary envelope verbatim"
    );
}

#[test]
fn fleet_request_shapes_match_wire_and_mutation_coordinates_are_internal() {
    let fleet = serde_json::to_value(RequestBody::SessionFleet {
        session_id: "session-root".to_string(),
    })
    .expect("encode session.fleet request");
    assert_eq!(
        fleet,
        serde_json::json!({"method": "session.fleet", "session_id": "session-root"})
    );

    let observe = serde_json::to_value(session_observe_request(
        "session-child".to_string(),
        7,
        false,
    ))
    .expect("encode session.observe request");
    assert_eq!(
        observe,
        serde_json::json!({
            "method": "session.observe",
            "session_id": "session-child",
            "last_event_limit": 7
        }),
        "metadata_only=false follows the authority's omitted-default wire"
    );

    let batch = session_observe_batch_request(
        vec!["session-z".to_string(), "session-a".to_string()],
        5,
        true,
    )
    .expect("build bounded observe batch");
    assert_eq!(
        serde_json::to_value(batch).expect("encode session.observe_batch request"),
        serde_json::json!({
            "method": "session.observe_batch",
            "session_ids": ["session-z", "session-a"],
            "last_event_limit": 5,
            "metadata_only": true
        })
    );

    let message = agent_message_request(
        "diffforge-agent-message-opaque".to_string(),
        "session-root".to_string(),
        41,
        "agent-child-7".to_string(),
        "please report".to_string(),
    );
    assert_eq!(
        serde_json::to_value(message).expect("encode agent.message request"),
        serde_json::json!({
            "method": "agent.message",
            "command_id": "diffforge-agent-message-opaque",
            "session_id": "session-root",
            "worker_generation": 41,
            "agent": "agent-child-7",
            "text": "please report"
        }),
        "the mutation wire receives attachment-derived generation and an internal command id"
    );
}

#[test]
fn fleet_folded_children_distinguishes_bounded_node_from_real_leaf() {
    let snapshot = bounded_fleet_snapshot();
    let node = &snapshot.roots[0];
    assert!(node.children.is_empty());
    assert_eq!(
        node.folded_children, 3,
        "children=[] with folded_children=3 is bounded, not a real leaf"
    );

    let real_leaf: FleetNodeWire = serde_json::from_value(serde_json::json!({
        "agent_id": "agent-leaf",
        "session_id": "session-leaf",
        "task": "finished leaf",
        "depth": 2,
        "parent_session_id": "session-child",
        "state": "done",
        "children": []
    }))
    .expect("decode an explicit real leaf");
    assert_eq!(real_leaf.folded_children, 0);
    assert!(real_leaf.children.is_empty());
}

#[test]
fn fleet_truncated_and_completeness_markers_round_trip_without_rewrite() {
    let snapshot = bounded_fleet_snapshot();
    assert!(
        snapshot.truncated,
        "daemon truncated:true must not be rewritten to a complete snapshot"
    );
    assert!(
        !snapshot.rollup.complete,
        "daemon complete:false must remain an honest bounded-tree marker"
    );
    assert!(
        !snapshot.rollup.metrics_complete,
        "metrics_complete:false must remain distinct from complete fleet metrics"
    );
    let encoded = serde_json::to_value(snapshot).expect("re-encode bounded fleet snapshot");
    assert_eq!(encoded["truncated"], true);
    assert_eq!(encoded["rollup"]["complete"], false);
    assert_eq!(encoded["rollup"]["metrics_complete"], false);
}

#[test]
fn fleet_metrics_and_usage_absence_are_typed_while_present_records_stay_verbatim() {
    let snapshot = bounded_fleet_snapshot();
    assert!(
        snapshot.roots[0].metrics.is_none(),
        "absent direct metrics are unknown, not a zero metrics record"
    );
    assert!(
        snapshot.rollup.metrics.usage.is_none(),
        "absent rollup usage is typed None, never fabricated zero usage"
    );
    assert!(
        snapshot.roots[0].callsign.is_none(),
        "an absent persisted callsign must remain None"
    );

    let metrics = serde_json::json!({
        "agent": "agent-folded",
        "session_id": "session-child",
        "head_seq": 12,
        "started_at_ms": 1000,
        "live": true,
        "tool_attempts": 2,
        "future_metric": {"opaque": [1, 2, 3]}
    });
    let usage = serde_json::json!({
        "logical_input_tokens": 91,
        "billed_output_tokens": 7,
        "future_cost_axis": {"microunits": 3}
    });
    let mut raw = bounded_fleet_response_json();
    raw["snapshot"]["roots"][0]["metrics"] = metrics.clone();
    raw["snapshot"]["rollup"]["metrics"]["usage"] = usage.clone();
    let body: ResponseBody = serde_json::from_value(raw).expect("decode opaque fleet metrics");
    let snapshot = session_fleet_response(body).expect("project opaque fleet metrics");
    assert_eq!(snapshot.roots[0].metrics.as_ref(), Some(&metrics));
    assert_eq!(snapshot.rollup.metrics.usage.as_ref(), Some(&usage));
    let encoded = serde_json::to_value(snapshot).expect("re-encode opaque fleet metrics");
    assert_eq!(encoded["roots"][0]["metrics"], metrics);
    assert_eq!(encoded["rollup"]["metrics"]["usage"], usage);
}

#[test]
fn fleet_unknown_state_delivery_and_run_state_round_trip_raw() {
    let raw_state = serde_json::json!("hibernating_remote");
    let state: FleetAgentStateWire =
        serde_json::from_value(raw_state.clone()).expect("decode future fleet state");
    assert!(
        matches!(&state, FleetAgentStateWire::Unknown(raw) if raw == "hibernating_remote"),
        "future fleet state was coerced instead of retaining its raw string: {state:?}"
    );
    assert_eq!(
        serde_json::to_value(state).expect("re-encode future fleet state"),
        raw_state
    );

    let raw_delivery = serde_json::json!("delivered_by_future_lane");
    let delivery: AgentMessageDeliveryWire =
        serde_json::from_value(raw_delivery.clone()).expect("decode future agent message delivery");
    assert!(
        matches!(&delivery, AgentMessageDeliveryWire::Unknown(raw) if raw == "delivered_by_future_lane"),
        "future delivery was coerced instead of retaining its raw string: {delivery:?}"
    );
    assert_eq!(
        serde_json::to_value(delivery).expect("re-encode future delivery"),
        raw_delivery
    );

    let raw_run_state = serde_json::json!({"state": "paused_for_future", "opaque": ["keep", 1]});
    let run_state: RunStateWire =
        serde_json::from_value(raw_run_state.clone()).expect("decode future child run state");
    assert!(
        matches!(&run_state, RunStateWire::Unknown(raw) if raw == &raw_run_state),
        "future child run state lost its complete raw object: {run_state:?}"
    );
    assert_eq!(
        serde_json::to_value(run_state).expect("re-encode future child run state"),
        raw_run_state
    );
}

#[test]
fn fleet_agent_message_receipt_keeps_real_child_coordinates() {
    let body: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "agent.message",
        "receipt": {
            "agent": "agent-child-7",
            "delivery": "delivered_steer",
            "child_run_id": "run-child-7",
            "child_run_state": {"state": "streaming"}
        }
    }))
    .expect("decode agent.message receipt");
    let receipt = agent_message_response(body).expect("project agent.message receipt");
    assert_eq!(receipt.agent, "agent-child-7");
    assert_eq!(receipt.delivery, AgentMessageDeliveryWire::DeliveredSteer);
    assert_eq!(receipt.child_run_id, "run-child-7");
    assert_eq!(receipt.child_run_state, RunStateWire::Streaming);
}

#[test]
fn fleet_observe_batch_keeps_digest_values_in_request_order() {
    let expected = vec![
        serde_json::json!({
            "session_id": "session-z",
            "head_seq": 17,
            "future_digest": {"opaque": "z"}
        }),
        serde_json::json!({
            "session_id": "session-a",
            "head_seq": 2,
            "future_digest": {"opaque": "a"}
        }),
    ];
    let body: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "session.observe_batch",
        "digests": expected.clone()
    }))
    .expect("decode session.observe_batch response");
    let digests =
        session_observe_batch_response(body).expect("project session.observe_batch response");
    assert_eq!(
        digests, expected,
        "observe_batch digests must remain in exact request order"
    );
    assert!(
        serde_json::from_value::<ResponseBody>(
            serde_json::json!({"method": "session.observe_batch"})
        )
        .is_err(),
        "a missing authoritative digests field is not a present empty batch"
    );
}

#[test]
fn fleet_observe_batch_enforces_one_through_sixty_four_ids() {
    let empty = session_observe_batch_request(Vec::new(), 0, false)
        .expect_err("zero session ids must be rejected");
    assert!(empty.contains("between 1 and 64"));

    let too_many = session_observe_batch_request(
        (0..65).map(|index| format!("session-{index}")).collect(),
        0,
        false,
    )
    .expect_err("more than 64 session ids must be rejected");
    assert!(too_many.contains("between 1 and 64"));

    session_observe_batch_request(vec!["session-only".to_string()], 0, false)
        .expect("one session id is valid");
    session_observe_batch_request(
        (0..64).map(|index| format!("session-{index}")).collect(),
        0,
        false,
    )
    .expect("64 session ids are valid");
}

#![allow(clippy::expect_used)]

use super::*;

fn graph_state_json() -> Value {
    serde_json::json!({
        "graph_id": "activation-graph-7",
        "ast": {
            "workflow_id": "release-review",
            "workflow_digest": "workflow-authority-digest",
            "input_type": "change",
            "output_type": "verdict",
            "nodes": [{
                "name": "review",
                "agent": {"type": "reviewer", "future_affinity": ["careful", 3]},
                "unknown_ast_field": {"preserve": true}
            }],
            "edges": [{"from": "review", "to": "publish", "kind": "future_edge"}],
            "max_back_edge_activations": 9,
            "future_topology": {"opaque": [1, {"two": 2}]}
        },
        "ast_digest": "BLAKE3:Topology-Fence/Keep_Exact==",
        "seed": {
            "artifact": "seed-1",
            "future_provenance": {"lane": 963, "opaque": true}
        },
        "phase": "active",
        "through_cursor": 9007199254740993_u64,
        "next_activation_order": 18446744073709551000_u64,
        "back_edge_activations": 7,
        "nodes": [{
            "node": "review",
            "phase": "activated",
            "iteration": 2,
            "activation_order": 81,
            "inputs": [{"future_input": {"nested": [1, 2, 3]}}],
            "outputs": [{"artifact": "review-output", "future": "keep"}],
            "updated_cursor": 9007199254740992_u64,
            "unknown_node_state": {"opaque": true}
        }],
        "activation_order": [{
            "activation_order": 81,
            "node": "review",
            "iteration": 2,
            "cursor": 9007199254740992_u64,
            "future_coordinate": {"opaque": "keep"}
        }]
    })
}

fn decoded_graph_state() -> WorkflowGraphStateV1 {
    let body: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "workflow.graph.state",
        "state": graph_state_json()
    }))
    .expect("decode workflow.graph.state response");
    workflow_graph_state_response(body)
        .expect("project workflow.graph.state response")
        .expect("fixture has an activation graph")
}

fn graph_watch_page_json() -> Value {
    serde_json::json!({
        "requested_after_cursor": 9007199254740993_u64,
        "replay_through_cursor": 9007199254741999_u64,
        "next_cursor": 9007199254741555_u64,
        "events": [{
            "cursor": 9007199254741001_u64,
            "event": {
                "type": "workflow_node_suspended_by_future_daemon",
                "graph_id": "activation-graph-7",
                "reason": {"kind": "future_reason", "facts": [1, {"two": 2}]},
                "future_event_field": {"opaque": true}
            }
        }]
    })
}

fn decoded_graph_watch_page() -> WorkflowGraphWatchPageV1 {
    let body: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "workflow.graph.watch",
        "page": graph_watch_page_json()
    }))
    .expect("decode workflow.graph.watch response");
    workflow_graph_watch_response(body).expect("project workflow.graph.watch response")
}

fn js_cursor_round_trip(value: &Value) -> String {
    if let Some(decimal) = value.as_str() {
        return decimal.to_string();
    }

    format!(
        "{:.0}",
        value
            .as_f64()
            .expect("cursor must cross JSON as a decimal string or number")
    )
}

#[test]
fn graph_feature_and_request_shapes_match_963() {
    assert_eq!(FEATURE_WORKFLOW_GRAPH_V1, "workflow_graph_v1");

    let latest = workflow_graph_state_request("session-7".to_string(), None);
    assert_eq!(
        serde_json::to_value(latest).expect("encode latest workflow.graph.state request"),
        serde_json::json!({
            "method": "workflow.graph.state",
            "session_id": "session-7"
        }),
        "graph_id None must omit the key and select the most-recently-changed graph"
    );

    let selected = workflow_graph_state_request(
        "session-7".to_string(),
        Some("activation-graph-7".to_string()),
    );
    assert_eq!(
        serde_json::to_value(selected).expect("encode selected workflow.graph.state request"),
        serde_json::json!({
            "method": "workflow.graph.state",
            "session_id": "session-7",
            "graph_id": "activation-graph-7"
        })
    );

    let watch = workflow_graph_watch_request("session-7".to_string(), 41, 256);
    assert_eq!(
        serde_json::to_value(watch).expect("encode workflow.graph.watch request"),
        serde_json::json!({
            "method": "workflow.graph.watch",
            "session_id": "session-7",
            "after_cursor": 41,
            "limit": 256
        })
    );
}

#[test]
fn graph_mutation_state_none_remains_honest_absence() {
    let body: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "workflow.graph.state"
    }))
    .expect("decode absent activation graph");
    let state = workflow_graph_state_response(body).expect("project absent activation graph");
    assert_eq!(
        state, None,
        "state None must remain honest absence; do not fabricate an empty activation graph"
    );
}

#[test]
fn graph_mutation_ast_digest_round_trips_verbatim() {
    let state = decoded_graph_state();
    assert_eq!(
        state.ast_digest, "BLAKE3:Topology-Fence/Keep_Exact==",
        "ast_digest is the daemon-issued topology fence and must round-trip byte-for-byte"
    );
    let encoded = serde_json::to_value(state).expect("re-encode activation graph state");
    assert_eq!(
        encoded["ast_digest"],
        graph_state_json()["ast_digest"],
        "ast_digest is the daemon-issued topology fence and must round-trip byte-for-byte"
    );
}

#[test]
fn graph_mutation_state_and_watch_cursors_round_trip_verbatim() {
    let state = decoded_graph_state();
    let encoded_state = serde_json::to_value(&state).expect("re-encode graph state cursors");

    let page = decoded_graph_watch_page();
    let encoded = serde_json::to_value(&page).expect("re-encode graph watch page");
    let expected = graph_watch_page_json();
    assert_eq!(
        (
            state.through_cursor,
            page.requested_after_cursor,
            page.replay_through_cursor,
            page.next_cursor
        ),
        (
            9007199254740993_u64,
            9007199254740993_u64,
            9007199254741999_u64,
            9007199254741555_u64
        ),
        "daemon-issued state/watch cursors must round-trip unchanged"
    );
    assert_eq!(
        js_cursor_round_trip(&encoded_state["through_cursor"]),
        "9007199254740993",
        "the Tauri-facing decimal string must survive a JavaScript round-trip exactly"
    );
    assert_eq!(
        encoded_state["through_cursor"],
        serde_json::json!("9007199254740993")
    );
    assert_eq!(
        encoded["requested_after_cursor"],
        serde_json::json!(expected["requested_after_cursor"].to_string())
    );
    assert_eq!(
        encoded["replay_through_cursor"],
        serde_json::json!(expected["replay_through_cursor"].to_string())
    );
    assert_eq!(
        encoded["next_cursor"],
        serde_json::json!(expected["next_cursor"].to_string())
    );
    assert_eq!(
        encoded["events"][0]["cursor"],
        serde_json::json!(expected["events"][0]["cursor"].to_string())
    );

    let returned_after_cursor = parse_workflow_graph_watch_after_cursor(
        encoded_state["through_cursor"]
            .as_str()
            .expect("Tauri-facing cursor must be a string"),
    )
    .expect("parse exact Tauri cursor for the daemon request");
    let request = workflow_graph_watch_request("session-7".to_string(), returned_after_cursor, 256);
    assert_eq!(
        serde_json::to_value(request).expect("encode round-tripped workflow.graph.watch request")
            ["after_cursor"],
        serde_json::json!(9007199254740993_u64),
        "the decimal string must parse back to the exact daemon u64"
    );
}

#[test]
fn workflow_graph_watch_rejects_non_decimal_after_cursor() {
    let error = parse_workflow_graph_watch_after_cursor("not-a-cursor")
        .expect_err("workflow_graph_watch must reject a non-decimal cursor");
    assert!(
        error.contains("after_cursor must be a decimal u64 string"),
        "unexpected parse error: {error}"
    );
}

#[test]
fn graph_mutation_unknown_journal_event_survives_as_raw_value() {
    let page = decoded_graph_watch_page();
    let expected = graph_watch_page_json()["events"][0]["event"].clone();
    assert_eq!(
        page.events[0].event, expected,
        "unknown journal event tag and payload must survive as raw Value"
    );
    assert_eq!(
        serde_json::to_value(page).expect("re-encode unknown journal event")["events"][0]["event"],
        expected,
        "unknown journal event tag and payload must survive as raw Value"
    );
}

#[test]
fn graph_mutation_nested_topology_records_round_trip_verbatim() {
    let expected = graph_state_json();
    let state = decoded_graph_state();
    let encoded = serde_json::to_value(state).expect("re-encode nested graph authority");
    assert_eq!(
        (
            &encoded["ast"],
            &encoded["seed"],
            &encoded["nodes"],
            &encoded["activation_order"]
        ),
        (
            &expected["ast"],
            &expected["seed"],
            &expected["nodes"],
            &expected["activation_order"]
        ),
        "ast, nodes, and activation_order must remain verbatim Values"
    );
}

#[test]
fn graph_unknown_phase_round_trips_without_coercion() {
    let raw = serde_json::json!("paused_for_future_reducer");
    let phase: WorkflowGraphPhaseV1 =
        serde_json::from_value(raw.clone()).expect("decode future graph phase");
    assert!(
        matches!(&phase, WorkflowGraphPhaseV1::Unknown(value) if value == "paused_for_future_reducer")
    );
    assert_eq!(
        serde_json::to_value(phase).expect("re-encode future graph phase"),
        raw
    );
}

#![allow(clippy::expect_used)]

use super::*;

fn workflow_instance_json() -> Value {
    serde_json::json!({
        "id": "release-review",
        "revision": 17,
        "digest": "user-source-digest",
        "template_digest": "compiled-template-digest",
        "pipe_version": "pipe/v1",
        "source": "user",
        "node_metadata": [{
            "node": "review",
            "agent_type": "reviewer",
            "future_contract": {"keep": [1, 2, 3]}
        }],
        "compiled_template": {
            "name": "release-review",
            "version": 41,
            "nodes": [{"name": "review", "future_gate": {"kind": "quorum"}}]
        }
    })
}

#[test]
fn workflow_feature_constants_match_daemon_tokens() {
    assert_eq!(FEATURE_CONVERGENCE_GRAPH_V1, "convergence_graph_v1");
    assert_eq!(FEATURE_CONVERGENCE_GRAPH_V2, "convergence_graph_v2");
    assert_eq!(FEATURE_CONVERGENCE_GRAPH_V3, "convergence_graph_v3");
    assert_eq!(FEATURE_CONVERGENCE_GRAPH_V4, "convergence_graph_v4");
    assert_eq!(FEATURE_LOOM_PIPE_DAG_V1, "loom_pipe_dag_v1");
    assert_eq!(FEATURE_WORKFLOW_CATALOG_V1, "workflow_catalog_v1");
    assert_eq!(FEATURE_WORKFLOW_INSTANCE_V1, "workflow_instance_v1");
    assert_eq!(
        FEATURE_SESSION_WORKFLOW_STATE_V1,
        "session_workflow_state_v1"
    );
}

#[test]
fn workflow_instance_round_trip_keeps_both_digests_distinct() {
    let body: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "workflow.instance",
        "instance": workflow_instance_json()
    }))
    .expect("decode workflow.instance response");
    let result = workflow_instance_response(body).expect("project workflow.instance response");
    let instance = result
        .instance
        .expect("daemon advertised an exact instance");

    assert_eq!(instance.digest.as_deref(), Some("user-source-digest"));
    assert_eq!(instance.template_digest, "compiled-template-digest");
    assert_ne!(
        instance.digest.as_deref(),
        Some(instance.template_digest.as_str())
    );
    assert_eq!(
        serde_json::to_value(instance).expect("re-encode workflow instance"),
        workflow_instance_json()
    );
}

#[test]
fn graph_pin_omits_fence_without_workflow_instance_feature() {
    let legacy_features = BTreeSet::from([FEATURE_CONVERGENCE_GRAPH_V1.to_string()]);
    let legacy_request = graph_pin_request_for_features(
        "command-legacy".to_string(),
        "session-1".to_string(),
        9,
        "release-review".to_string(),
        Some("compiled-template-digest".to_string()),
        &legacy_features,
    );
    let legacy_json = serde_json::to_value(legacy_request).expect("encode legacy graph.pin");
    assert!(
        legacy_json.get("expected_digest").is_none(),
        "feature absence must remove the key, not serialize null or a fabricated fence: {legacy_json}"
    );

    let fenced_features = BTreeSet::from([
        FEATURE_CONVERGENCE_GRAPH_V1.to_string(),
        FEATURE_WORKFLOW_INSTANCE_V1.to_string(),
    ]);
    let fenced_request = graph_pin_request_for_features(
        "command-fenced".to_string(),
        "session-1".to_string(),
        9,
        "release-review".to_string(),
        Some("compiled-template-digest".to_string()),
        &fenced_features,
    );
    assert_eq!(
        serde_json::to_value(fenced_request).expect("encode fenced graph.pin")["expected_digest"],
        "compiled-template-digest"
    );
}

#[test]
fn unknown_workflow_source_and_catalog_origin_round_trip_raw() {
    let source_raw = serde_json::json!("federated_registry");
    let source: WorkflowInstanceSourceV1 =
        serde_json::from_value(source_raw.clone()).expect("decode future workflow source");
    let origin_raw = serde_json::json!({
        "origin": "partner_registry",
        "id": "partner-flow",
        "main_session_eligible": true,
        "partner_record": {"opaque": ["retain", 7]}
    });
    let entry: WorkflowCatalogEntryV1 =
        serde_json::from_value(origin_raw.clone()).expect("decode future catalog origin");
    assert!(
        matches!(
            &source,
            WorkflowInstanceSourceV1::Unknown(raw) if raw == "federated_registry"
        ) && matches!(&entry, WorkflowCatalogEntryV1::Unknown(raw) if raw == &origin_raw),
        "future tags were coerced: source={source:?}, origin={entry:?}"
    );
    assert_eq!(
        serde_json::to_value(source).expect("re-encode future workflow source"),
        source_raw
    );
    assert_eq!(
        serde_json::to_value(entry).expect("re-encode future catalog origin"),
        origin_raw
    );
}

#[test]
fn workflow_revision_conflict_exposes_typed_fence_coordinates() {
    let body: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "error",
        "code": "revision_conflict",
        "message": "workflow revision moved",
        "retryable": true,
        "data": {
            "kind": "workflow_revision_conflict",
            "expected_digest": "compiled-template-digest",
            "current_digest": "new-template-digest",
            "current_revision": 18
        }
    }))
    .expect("decode workflow revision conflict");
    let error = graph_pin_response(body).expect_err("stale fence must reject graph.pin");
    let Some(WorkflowErrorData::WorkflowRevisionConflict(conflict)) = error.data.as_ref() else {
        panic!("revision conflict did not remain typed: {error:?}");
    };
    assert_eq!(conflict.expected_digest, "compiled-template-digest");
    assert_eq!(conflict.current_digest, "new-template-digest");
    assert_eq!(conflict.current_revision, 18);
    assert_eq!(
        serde_json::to_value(error).expect("serialize typed Tauri rejection")["data"],
        serde_json::json!({
            "kind": "workflow_revision_conflict",
            "expected_digest": "compiled-template-digest",
            "current_digest": "new-template-digest",
            "current_revision": 18
        })
    );
}

#[test]
fn catalog_and_instance_absence_are_not_fabricated() {
    let body: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "loom.list",
        "agent_types": [],
        "cli_present": {}
    }))
    .expect("decode pre-catalog loom.list response");
    let result = loom_list_response(body).expect("project pre-catalog loom.list response");
    let missing: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "workflow.instance"
    }))
    .expect("decode absent workflow instance");
    let missing = workflow_instance_response(missing).expect("project absent instance");
    assert!(
        result.workflows.is_empty()
            && result.workflow_catalog.is_none()
            && missing.instance.is_none(),
        "absence was fabricated: workflows={}, catalog={:?}, instance={}",
        result.workflows.len(),
        result.workflow_catalog,
        missing.instance.is_some()
    );
    assert_eq!(
        serde_json::to_value(&result).expect("encode additive loom.list result"),
        serde_json::json!({"agent_types": [], "cli_present": {}}),
        "empty additive fields must not change the P0.3 byte shape"
    );
    assert_eq!(
        missing.instance, None,
        "absence is not a current row, built-in, or local compilation"
    );
}

#[test]
fn workflow_catalog_absence_is_distinct_from_present_empty_catalog() {
    let missing: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "loom.list"
    }))
    .expect("decode loom.list without workflow_catalog");
    let missing = loom_list_response(missing).expect("project missing workflow_catalog");

    let empty: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "loom.list",
        "workflow_catalog": []
    }))
    .expect("decode loom.list with empty workflow_catalog");
    let empty = loom_list_response(empty).expect("project empty workflow_catalog");

    assert_eq!(missing.workflow_catalog, None);
    assert_eq!(empty.workflow_catalog, Some(vec![]));
    assert_ne!(missing.workflow_catalog, empty.workflow_catalog);
}

#[test]
fn workflow_request_shapes_match_the_daemon_contract() {
    assert_eq!(
        serde_json::to_value(RequestBody::WorkflowInstance {
            workflow_id: "release-review".to_string(),
            template_digest: None,
        })
        .expect("encode workflow.instance request"),
        serde_json::json!({
            "method": "workflow.instance",
            "workflow_id": "release-review"
        })
    );
    assert_eq!(
        serde_json::to_value(RequestBody::GraphStatus {
            session_id: "session-1".to_string()
        })
        .expect("encode graph.status request"),
        serde_json::json!({"method": "graph.status", "session_id": "session-1"})
    );
    assert_eq!(
        serde_json::to_value(RequestBody::GraphInspect {
            session_id: "session-1".to_string(),
            cursor: None,
            limit: 100,
        })
        .expect("encode graph.inspect request"),
        serde_json::json!({
            "method": "graph.inspect",
            "session_id": "session-1",
            "limit": 100
        })
    );
    assert_eq!(
        serde_json::to_value(RequestBody::GraphAbandon {
            command_id: "command-1".to_string(),
            session_id: "session-1".to_string(),
            worker_generation: 9,
            why: "operator stopped the workflow".to_string(),
        })
        .expect("encode graph.abandon request"),
        serde_json::json!({
            "method": "graph.abandon",
            "command_id": "command-1",
            "session_id": "session-1",
            "worker_generation": 9,
            "why": "operator stopped the workflow"
        })
    );
    assert_eq!(
        serde_json::to_value(RequestBody::GraphRunSetOpen {
            command_id: "command-2".to_string(),
            session_id: "session-1".to_string(),
            worker_generation: 9,
            plan_item_id: "plan-7".to_string(),
            plan_event_seq: 81,
        })
        .expect("encode graph.run_set.open request"),
        serde_json::json!({
            "method": "graph.run_set.open",
            "command_id": "command-2",
            "session_id": "session-1",
            "worker_generation": 9,
            "plan_item_id": "plan-7",
            "plan_event_seq": 81
        })
    );
    assert_eq!(
        serde_json::to_value(RequestBody::LoomRegisterWorkflow {
            source: "workflow release-review\nreview @reviewer: ship".to_string()
        })
        .expect("encode loom.register_workflow request"),
        serde_json::json!({
            "method": "loom.register_workflow",
            "source": "workflow release-review\nreview @reviewer: ship"
        })
    );
}

#[test]
fn graph_status_and_inspect_keep_nested_authority_verbatim() {
    let nodes = serde_json::json!([{
        "node": "review",
        "gate": {"kind": "future_gate", "threshold": 3},
        "future_status": {"opaque": true}
    }]);
    let blocked_reason = serde_json::json!({"kind": "future_block", "facts": [1, 2]});
    let run_set = serde_json::json!({"id": "run-set-1", "future_children": [{"x": 1}]});
    let body: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "graph.status",
        "status": {
            "graph_id": "graph-1",
            "template": "release-review",
            "digest": "compiled-template-digest",
            "template_version": 41,
            "start_node": null,
            "phase": "waiting_on_future_authority",
            "current_node": null,
            "ready_nodes": ["review"],
            "attempt": 2,
            "nodes": nodes,
            "blocked_reason": blocked_reason,
            "pending_menu": {"future_menu_coordinate": "menu-1"},
            "pending_menus": ["menu-1", {"future": "menu-2"}],
            "run_set": run_set
        }
    }))
    .expect("decode graph.status response");
    let status = graph_status_response(body)
        .expect("project graph.status response")
        .expect("active graph status");
    assert_eq!(status.phase, "waiting_on_future_authority");
    assert_eq!(status.nodes, nodes);
    assert_eq!(status.blocked_reason, Some(blocked_reason));
    assert_eq!(status.run_set, Some(run_set));
    assert_eq!(status.current_node, None);

    let snapshot = serde_json::json!({
        "through_seq": 99,
        "evidence": [{"future_provenance": {"verbatim": true}}]
    });
    let inspect: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "graph.inspect",
        "snapshot": snapshot,
        "next_cursor": "opaque-page-2"
    }))
    .expect("decode graph.inspect response");
    let result = graph_inspect_response(inspect).expect("project graph.inspect response");
    assert_eq!(result.snapshot, snapshot);
    assert_eq!(result.next_cursor.as_deref(), Some("opaque-page-2"));
}

#[test]
fn workflow_registration_preserves_full_daemon_compile_error() {
    let full_message =
        "pipe rejected: line 2 unknown agent @reviewer; line 4 invalid back edge ↺missing";
    let body: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "error",
        "code": "invalid_argument",
        "message": full_message,
        "retryable": false
    }))
    .expect("decode bad-pipe response");
    let error = loom_workflow_registration_response(body)
        .expect_err("a bad pipe must not produce a registration receipt");
    assert_eq!(error.code, "invalid_argument");
    assert_eq!(error.message, full_message);
    assert!(!error.retryable);
    assert_eq!(error.data, None);
}

#![allow(clippy::expect_used)]

use super::*;

fn policy_json() -> Value {
    serde_json::json!({
        "list": "view",
        "register": "control",
        "register_requires_control_attachment": true,
        "remove": "control",
        "remove_requires_control_attachment": true,
        "watch": "view"
    })
}

fn sources_json() -> Value {
    serde_json::json!([
        {
            "source": "sms",
            "availability": {"state": "available"}
        },
        {
            "source": "process",
            "availability": {
                "state": "unavailable",
                "reason": "adapter_inactive"
            }
        }
    ])
}

fn registration_json() -> Value {
    serde_json::json!({
        "monitor_id": "monitor-962",
        "session_id": "session-provider-1",
        "source": {
            "kind": "sms",
            "future_source_field": {"opaque": [1, 2, 3]}
        },
        "filter": {
            "field": "body",
            "operator": "contains",
            "value": "ship it",
            "case_sensitive": false,
            "future_filter_field": {"opaque": true}
        },
        "action": {
            "report": true,
            "follow_up": "continue",
            "future_action_field": ["keep", 7]
        },
        "occurrence": "every",
        "created_at_ms": 1_787_860_800_000_u64,
        "start_source_sequence": 9_007_199_254_740_994_u64
    })
}

fn delivery_report_json(cursor: u64) -> Value {
    serde_json::json!({
        "report_id": "report-1",
        "monitor_id": "monitor-962",
        "session_id": "session-provider-1",
        "source": "sms",
        "status": "matched",
        "events": [{
            "sequence": 41,
            "observed_at_ms": 1_787_860_800_001_u64,
            "payload": {
                "kind": "sms",
                "address": "+15550000000",
                "body": "ship it",
                "received_at_ms": 1_787_860_800_000_i64,
                "future_payload_field": {"verbatim": true}
            },
            "future_event_field": [1, {"two": 2}]
        }],
        "coalesced_count": 3,
        "omitted_count": 2,
        "action": {
            "report": true,
            "follow_up": "continue",
            "future_action_field": {"keep": true}
        },
        "cursor": cursor,
        "dedupe": {
            "delivery_key": "session-provider-1:9007199254740993",
            "report_key": "report-1"
        }
    })
}

#[test]
fn monitor_feature_tokens_and_request_shapes_match_962() {
    assert_eq!(FEATURE_MONITOR_CONTROL_V1, "monitor_control_v1");
    assert_eq!(FEATURE_MONITOR_DELIVERY_V1, "monitor_delivery_v1");

    // Compile-check the public mutation boundary: command_id and generation
    // are deliberately absent, and filter is optional at the Tauri boundary.
    drop(monitor_register(
        "local-session-1".to_string(),
        serde_json::json!({"kind": "sms"}),
        None,
        serde_json::json!({"report": true}),
        serde_json::json!("every"),
        serde_json::json!({"kind": "session"}),
    ));
    drop(monitor_remove(
        "local-session-1".to_string(),
        "monitor-962".to_string(),
    ));

    assert_eq!(
        serde_json::to_value(monitor_list_request("session-provider-1".to_string()))
            .expect("encode monitor.list request"),
        serde_json::json!({
            "method": "monitor.list",
            "session_id": "session-provider-1"
        })
    );

    let source = serde_json::json!({"kind": "sms", "future": {"keep": true}});
    let filter = serde_json::json!({
        "field": "body",
        "operator": "contains",
        "value": "ship it",
        "case_sensitive": false,
        "future": [1, 2]
    });
    let action = serde_json::json!({"report": true, "future": "keep"});
    let occurrence = serde_json::json!("every");
    let lifetime = serde_json::json!({"kind": "timeout", "timeout_ms": 60_000});
    let register = monitor_register_request(
        "internal-command-1".to_string(),
        "session-provider-1".to_string(),
        73,
        source.clone(),
        Some(filter.clone()),
        action.clone(),
        occurrence.clone(),
        lifetime.clone(),
    );
    assert_eq!(
        serde_json::to_value(register).expect("encode monitor.register request"),
        serde_json::json!({
            "method": "monitor.register",
            "command_id": "internal-command-1",
            "session_id": "session-provider-1",
            "worker_generation": 73,
            "source": source,
            "filter": filter,
            "action": action,
            "occurrence": occurrence,
            "lifetime": lifetime
        }),
        "deep vocabulary and internal mutation coordinates must reach the daemon unchanged"
    );

    assert_eq!(
        serde_json::to_value(monitor_remove_request(
            "internal-command-3".to_string(),
            "session-provider-1".to_string(),
            75,
            "monitor-962".to_string(),
        ))
        .expect("encode monitor.remove request"),
        serde_json::json!({
            "method": "monitor.remove",
            "command_id": "internal-command-3",
            "session_id": "session-provider-1",
            "worker_generation": 75,
            "monitor_id": "monitor-962"
        })
    );
}

#[test]
fn monitor_register_optional_filter_wire_contract() {
    fn encode(filter: Option<Value>) -> Value {
        serde_json::to_value(monitor_register_request(
            "internal-command-filter-pin".to_string(),
            "session-provider-1".to_string(),
            74,
            serde_json::json!({"kind": "sms"}),
            filter,
            serde_json::json!({"report": true}),
            serde_json::json!("once"),
            serde_json::json!({"kind": "session"}),
        ))
        .expect("encode monitor.register filter pin")
    }

    let missing = encode(None);
    assert!(
        !missing
            .as_object()
            .expect("monitor.register request must encode as an object")
            .contains_key("filter"),
        "a missing Tauri filter argument must be absent on the daemon wire"
    );

    let explicit_null = encode(Some(Value::Null));
    assert!(
        !explicit_null
            .as_object()
            .expect("monitor.register request must encode as an object")
            .contains_key("filter"),
        "an explicit null Tauri filter must be absent on the daemon wire"
    );

    let filter = serde_json::json!({
        "field": "body",
        "operator": "contains",
        "value": "ship it",
        "future": {"keep": [1, 2, 3]}
    });
    let with_filter = encode(Some(filter.clone()));
    assert_eq!(
        with_filter.get("filter"),
        Some(&filter),
        "a real filter object must reach the daemon wire verbatim"
    );
}

#[test]
fn monitor_outcome_unknown_discriminants_preserve_complete_raw_objects() {
    let list_raw = serde_json::json!({
        "status": "partially_listed",
        "visible": 3,
        "future": {"opaque": [1, 2, 3]}
    });
    let register_raw = serde_json::json!({
        "status": "queued_for_registration",
        "ticket": "future-1",
        "future": ["keep", 7]
    });
    let remove_raw = serde_json::json!({
        "status": "tombstoned",
        "monitor_id": "monitor-962",
        "future": {"keep": true}
    });

    let list: MonitorListOutcomeV1 =
        serde_json::from_value(list_raw.clone()).expect("decode future list outcome");
    let register: MonitorRegisterOutcomeV1 =
        serde_json::from_value(register_raw.clone()).expect("decode future register outcome");
    let remove: MonitorRemoveOutcomeV1 =
        serde_json::from_value(remove_raw.clone()).expect("decode future remove outcome");

    assert!(matches!(&list, MonitorListOutcomeV1::Unknown { raw } if raw == &list_raw));
    assert!(matches!(&register, MonitorRegisterOutcomeV1::Unknown { raw } if raw == &register_raw));
    assert!(matches!(&remove, MonitorRemoveOutcomeV1::Unknown { raw } if raw == &remove_raw));
    assert_eq!(
        serde_json::to_value(list).expect("re-encode list"),
        list_raw
    );
    assert_eq!(
        serde_json::to_value(register).expect("re-encode register"),
        register_raw
    );
    assert_eq!(
        serde_json::to_value(remove).expect("re-encode remove"),
        remove_raw
    );
}

#[test]
fn monitor_structured_rejections_remain_typed_data() {
    let invalid: MonitorRegisterOutcomeV1 = serde_json::from_value(serde_json::json!({
        "status": "rejected",
        "rejection": {
            "reason": "invalid_request",
            "field": "filter.operator",
            "detail": "operator is incompatible with the source"
        }
    }))
    .expect("decode structured invalid_request rejection");
    let not_found: MonitorRemoveOutcomeV1 = serde_json::from_value(serde_json::json!({
        "status": "rejected",
        "rejection": {
            "reason": "not_found",
            "monitor_id": "monitor-missing"
        }
    }))
    .expect("decode structured not_found rejection");

    assert!(matches!(
        &invalid,
        MonitorRegisterOutcomeV1::Rejected {
            rejection: MonitorControlRejectionV1::InvalidRequest { field, detail }
        } if field.as_deref() == Some("filter.operator")
            && detail == "operator is incompatible with the source"
    ));
    assert!(matches!(
        &not_found,
        MonitorRemoveOutcomeV1::Rejected {
            rejection: MonitorControlRejectionV1::NotFound { monitor_id }
        } if monitor_id == "monitor-missing"
    ));
    let encoded = serde_json::to_value(invalid).expect("serialize typed rejection");
    assert!(encoded["rejection"].is_object());
    assert_eq!(encoded["rejection"]["reason"], "invalid_request");
    assert_eq!(encoded["rejection"]["field"], "filter.operator");
    assert_eq!(
        encoded["rejection"]["detail"],
        "operator is incompatible with the source"
    );
}

#[test]
fn monitor_unknown_rejection_preserves_raw_reason_object() {
    let raw = serde_json::json!({
        "reason": "approval_pending",
        "approval_id": "approval-1",
        "future": {"opaque": [1, 2]}
    });
    let rejection: MonitorControlRejectionV1 =
        serde_json::from_value(raw.clone()).expect("decode future monitor rejection");
    assert!(matches!(
        &rejection,
        MonitorControlRejectionV1::Unknown { raw: preserved } if preserved == &raw
    ));
    assert_eq!(
        serde_json::to_value(rejection).expect("re-encode future rejection"),
        raw
    );
}

#[test]
fn monitor_availability_absence_and_unknown_never_become_available() {
    let missing_state_raw = serde_json::json!({"reason": "not_probed"});
    let future_state_raw = serde_json::json!({
        "state": "probing",
        "reason": {"kind": "warming_up", "retry_after_ms": 500}
    });
    let unavailable_reason = serde_json::json!({
        "kind": "platform_restricted",
        "future": [1, 2, 3]
    });
    let missing: MonitorSourceAvailabilityStateV1 =
        serde_json::from_value(missing_state_raw.clone()).expect("decode missing state");
    let future: MonitorSourceAvailabilityStateV1 =
        serde_json::from_value(future_state_raw.clone()).expect("decode future state");
    let unavailable: MonitorSourceAvailabilityStateV1 = serde_json::from_value(serde_json::json!({
        "state": "unavailable",
        "reason": unavailable_reason
    }))
    .expect("decode unavailable state");

    assert!(matches!(
        &missing,
        MonitorSourceAvailabilityStateV1::Unknown { raw } if raw == &missing_state_raw
    ));
    assert!(matches!(
        &future,
        MonitorSourceAvailabilityStateV1::Unknown { raw } if raw == &future_state_raw
    ));
    assert!(matches!(
        &unavailable,
        MonitorSourceAvailabilityStateV1::Unavailable { reason: Some(reason) }
            if reason == &unavailable_reason
    ));
    assert!(!matches!(
        missing,
        MonitorSourceAvailabilityStateV1::Available
    ));
    assert!(!matches!(
        future,
        MonitorSourceAvailabilityStateV1::Available
    ));
}

#[test]
fn monitor_watch_cursor_above_js_safe_integer_round_trips_exactly() {
    const CURSOR: u64 = 9_007_199_254_740_993;
    // Compile-check the actual Tauri boundary, not only the numeric wire
    // helper: changing after_cursor back to u64 must break this pin.
    drop(monitor_watch(
        "local-session-1".to_string(),
        "9007199254740993".to_string(),
    ));
    let parsed = parse_monitor_watch_after_cursor("9007199254740993")
        .expect("parse >2^53 decimal monitor cursor");
    assert_eq!(parsed, CURSOR);
    let request = monitor_watch_request("session-provider-1".to_string(), parsed);
    assert_eq!(
        serde_json::to_value(request).expect("encode monitor.watch request")["after_cursor"],
        serde_json::json!(CURSOR),
        "daemon wire must receive the exact numeric u64"
    );

    let body: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "monitor.watch",
        "receipt": {
            "session_id": "session-provider-1",
            "policy": policy_json(),
            "sources": sources_json(),
            "outcome": {
                "status": "watching",
                "watch_id": "watch-1",
                "requested_after_cursor": CURSOR,
                "replay_through_cursor": CURSOR + 11
            }
        }
    }))
    .expect("decode monitor.watch receipt");
    let receipt = monitor_watch_response(body).expect("project monitor.watch receipt");
    let encoded = serde_json::to_value(receipt).expect("serialize Tauri monitor.watch receipt");
    assert_eq!(
        encoded["outcome"]["requested_after_cursor"],
        "9007199254740993"
    );
    assert_eq!(
        encoded["outcome"]["replay_through_cursor"],
        "9007199254741004"
    );
}

#[test]
fn monitor_watch_rejects_non_decimal_empty_and_overflow_cursors() {
    for cursor in ["", "not-a-cursor", "+41", "18446744073709551616"] {
        let error = parse_monitor_watch_after_cursor(cursor)
            .expect_err("invalid monitor cursor must be rejected");
        assert!(
            error.contains("after_cursor must be a decimal u64 string"),
            "unexpected error for {cursor:?}: {error}"
        );
    }
}

#[test]
fn monitor_delivery_report_and_caught_up_cursors_serialize_as_strings() {
    const CURSOR: u64 = 9_007_199_254_740_993;
    let report: MonitorDeliveryReportV1 =
        serde_json::from_value(delivery_report_json(CURSOR)).expect("decode monitor report");
    let encoded = serde_json::to_value(&report).expect("serialize monitor report for Tauri");
    assert_eq!(encoded["cursor"], "9007199254740993");
    assert_eq!(encoded["events"], delivery_report_json(CURSOR)["events"]);
    assert_eq!(encoded["action"], delivery_report_json(CURSOR)["action"]);

    let caught_up = MonitorDeliveryCaughtUpEventV1 {
        watch_id: "watch-1".to_string(),
        session_id: "session-provider-1".to_string(),
        high_water_cursor: CURSOR + 50,
    };
    assert_eq!(
        serde_json::to_value(caught_up).expect("serialize caught-up event")["high_water_cursor"],
        "9007199254741043"
    );
}

#[test]
fn monitor_cursor_ahead_rejection_keeps_typed_coordinates_as_strings_for_js() {
    const REQUESTED: u64 = 9_007_199_254_740_993;
    const HEAD: u64 = 9_007_199_254_740_992;
    let rejection: MonitorControlRejectionV1 = serde_json::from_value(serde_json::json!({
        "reason": "cursor_ahead",
        "requested": REQUESTED,
        "head": HEAD
    }))
    .expect("decode cursor_ahead rejection");
    assert!(matches!(
        rejection,
        MonitorControlRejectionV1::CursorAhead {
            requested: REQUESTED,
            head: HEAD
        }
    ));
    let encoded = serde_json::to_value(rejection).expect("serialize cursor_ahead rejection");
    assert_eq!(encoded["requested"], "9007199254740993");
    assert_eq!(encoded["head"], "9007199254740992");
}

#[test]
fn monitor_empty_set_exists_only_inside_listed_outcome() {
    let listed: MonitorListOutcomeV1 =
        serde_json::from_value(serde_json::json!({"status": "listed"}))
            .expect("decode listed empty monitor set");
    let rejected: MonitorListOutcomeV1 = serde_json::from_value(serde_json::json!({
        "status": "rejected",
        "rejection": {"reason": "service_stopped"}
    }))
    .expect("decode unavailable monitor list");

    assert!(matches!(
        &listed,
        MonitorListOutcomeV1::Listed { monitors } if monitors.is_empty()
    ));
    assert!(matches!(
        &rejected,
        MonitorListOutcomeV1::Rejected {
            rejection: MonitorControlRejectionV1::ServiceStopped
        }
    ));
    let listed_json = serde_json::to_value(listed).expect("serialize listed outcome");
    let rejected_json = serde_json::to_value(rejected).expect("serialize rejected outcome");
    assert_eq!(listed_json["monitors"], serde_json::json!([]));
    assert!(
        rejected_json.get("monitors").is_none(),
        "non-Listed outcome must not fabricate an empty monitor set: {rejected_json}"
    );
}

#[test]
fn monitor_list_receipt_types_identity_policy_and_verbatim_registration_records() {
    let body: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "monitor.list",
        "receipt": {
            "session_id": "session-provider-1",
            "policy": policy_json(),
            "sources": sources_json(),
            "outcome": {
                "status": "listed",
                "monitors": [registration_json()]
            }
        }
    }))
    .expect("decode typed monitor.list response");
    let receipt = monitor_list_response(body).expect("project monitor.list receipt");
    assert_eq!(receipt.session_id, "session-provider-1");
    assert_eq!(receipt.policy.list, MonitorPolicyCapabilityV1::View);
    assert_eq!(receipt.policy.register, MonitorPolicyCapabilityV1::Control);
    assert!(receipt.policy.register_requires_control_attachment);
    let MonitorListOutcomeV1::Listed { monitors } = &receipt.outcome else {
        panic!("expected listed outcome: {:?}", receipt.outcome);
    };
    assert_eq!(monitors[0].monitor_id, "monitor-962");
    assert_eq!(monitors[0].session_id, "session-provider-1");
    assert_eq!(monitors[0].source, registration_json()["source"]);
    assert_eq!(
        monitors[0].filter.as_ref(),
        Some(&registration_json()["filter"])
    );
    assert_eq!(monitors[0].action, registration_json()["action"]);
    assert_eq!(
        serde_json::to_value(receipt).expect("serialize Tauri monitor.list receipt")["outcome"]
            ["monitors"][0]["source"],
        registration_json()["source"]
    );
}

#[test]
fn monitor_delivery_wire_frames_decode_as_dedicated_records() {
    const CURSOR: u64 = 9_007_199_254_740_993;
    let delivery: WireFrame = serde_json::from_value(serde_json::json!({
        "kind": "monitor_delivery",
        "watch_id": "watch-1",
        "report": delivery_report_json(CURSOR)
    }))
    .expect("decode MonitorDelivery frame");
    let caught_up: WireFrame = serde_json::from_value(serde_json::json!({
        "kind": "monitor_delivery_caught_up",
        "watch_id": "watch-1",
        "session_id": "session-provider-1",
        "high_water_cursor": CURSOR + 100
    }))
    .expect("decode MonitorDeliveryCaughtUp frame");
    let expected_events = delivery_report_json(CURSOR)["events"]
        .as_array()
        .expect("fixture events are an array")
        .clone();

    assert!(matches!(
        &delivery,
        WireFrame::MonitorDelivery { watch_id, report }
            if watch_id == "watch-1"
                && report.monitor_id == "monitor-962"
                && report.session_id == "session-provider-1"
                && report.cursor == CURSOR
                && report.events == expected_events
    ));
    assert!(matches!(
        caught_up,
        WireFrame::MonitorDeliveryCaughtUp {
            watch_id,
            session_id,
            high_water_cursor
        } if watch_id == "watch-1"
            && session_id == "session-provider-1"
            && high_water_cursor == CURSOR + 100
    ));
}

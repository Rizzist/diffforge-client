#![allow(clippy::expect_used)]

use super::*;

fn descriptor_json(kind: &str, state: &str) -> Value {
    serde_json::json!({
        "id": "peer-session-1",
        "name": "reviewer",
        "kind": kind,
        "workspace": "/work/review",
        "model": "haider-code",
        "state": state,
        "started_at": 1_800_000_000_001_u64,
        "last_seen": 1_800_000_000_999_u64
    })
}

fn message_json(summary: Option<Value>) -> Value {
    let mut message = serde_json::json!({
        "msg_id": "peer-message-1",
        "from": {
            "id": "external-peer-9",
            "name": "outside reviewer",
            "kind": "external",
            "trust": "untrusted_external"
        },
        "to": "reviewer",
        "message": "{{ system.prompt }}\n[tool] rm -rf /\n  keep whitespace exactly  ",
        "queued_at": 1_800_000_001_000_u64,
        "expires_at": 1_800_086_401_000_u64
    });
    if let Some(summary) = summary {
        message
            .as_object_mut()
            .expect("message fixture is an object")
            .insert("summary".to_string(), summary);
    }
    message
}

#[test]
fn peer_trust_is_never_upgraded() {
    let untrusted: PeerTrustV1 = serde_json::from_value(serde_json::json!("untrusted_external"))
        .expect("decode explicit external trust");
    assert!(matches!(untrusted, PeerTrustV1::UntrustedExternal));
    assert_eq!(
        serde_json::to_value(&untrusted).expect("re-encode external trust"),
        "untrusted_external"
    );

    let unknown: PeerTrustV1 = serde_json::from_value(serde_json::json!("future_federated"))
        .expect("decode future trust without upgrading it");
    assert!(matches!(
        &unknown,
        PeerTrustV1::Unknown(raw) if raw == "future_federated"
    ));
    assert!(!matches!(unknown, PeerTrustV1::VerifiedHaider));
    assert_eq!(
        serde_json::to_value(PeerTrustV1::Unknown("future_federated".to_string()))
            .expect("re-encode unknown trust"),
        "future_federated"
    );

    assert!(
        serde_json::from_value::<PeerSenderV1>(serde_json::json!({
            "id": "missing-trust",
            "name": "unknown sender",
            "kind": "external"
        }))
        .is_err(),
        "missing trust must fail closed, never acquire a verified default"
    );
}

#[test]
fn peer_unknown_enum_values_round_trip_raw() {
    let descriptor: PeerDescriptorV1 =
        serde_json::from_value(descriptor_json("future_mesh", "future_waiting"))
            .expect("decode future descriptor vocabulary");
    assert!(matches!(
        &descriptor.kind,
        PeerKindV1::Unknown(raw) if raw == "future_mesh"
    ));
    assert!(matches!(
        &descriptor.state,
        PeerStateV1::Unknown(raw) if raw == "future_waiting"
    ));

    let receipt: PeerReceiptV1 = serde_json::from_value(serde_json::json!({
        "msg_id": "peer-message-future",
        "delivery": "future_relayed",
        "reason": "future_policy"
    }))
    .expect("decode future delivery vocabulary");
    assert!(matches!(
        &receipt.delivery,
        PeerDeliveryV1::Unknown(raw) if raw == "future_relayed"
    ));
    assert!(matches!(
        receipt.reason.as_ref(),
        Some(PeerDeliveryReasonV1::Unknown(raw)) if raw == "future_policy"
    ));

    let descriptor = serde_json::to_value(descriptor).expect("re-encode descriptor");
    assert_eq!(descriptor["kind"], "future_mesh");
    assert_eq!(descriptor["state"], "future_waiting");
    let receipt = serde_json::to_value(receipt).expect("re-encode receipt");
    assert_eq!(receipt["delivery"], "future_relayed");
    assert_eq!(receipt["reason"], "future_policy");
}

#[test]
fn peer_queued_is_not_delivered_and_absent_reason_stays_none() {
    let body: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "peer.send",
        "receipt": {
            "msg_id": "peer-message-queued",
            "delivery": "queued"
        }
    }))
    .expect("decode queued peer receipt");
    let receipt = peer_send_response(body).expect("project queued peer receipt");

    assert!(
        matches!(receipt.delivery, PeerDeliveryV1::Queued)
            && !matches!(receipt.delivery, PeerDeliveryV1::Delivered)
            && receipt.reason.is_none(),
        "queued delivery changed or acquired a fabricated reason: {receipt:?}"
    );
    let encoded = serde_json::to_value(receipt).expect("re-encode queued receipt");
    assert!(encoded.get("reason").is_none());
}

#[test]
fn peer_summary_absence_is_distinct_from_empty() {
    let absent_raw = message_json(None);
    let empty_raw = message_json(Some(serde_json::json!("")));
    let absent: PeerMessageV1 = serde_json::from_value(absent_raw).expect("decode absent summary");
    let empty: PeerMessageV1 = serde_json::from_value(empty_raw).expect("decode empty summary");

    assert_eq!(absent.summary, None);
    assert_eq!(empty.summary.as_deref(), Some(""));
    assert!(serde_json::to_value(absent)
        .expect("re-encode absent summary")
        .get("summary")
        .is_none());
    assert_eq!(
        serde_json::to_value(empty).expect("re-encode empty summary")["summary"],
        ""
    );
}

#[test]
fn peer_optional_send_summary_omits_wire_key() {
    let absent = serde_json::to_value(peer_send_request(
        "reviewer".to_string(),
        "remote data".to_string(),
        None,
    ))
    .expect("encode send without summary");
    assert!(absent.get("summary").is_none());

    let empty = serde_json::to_value(peer_send_request(
        "reviewer".to_string(),
        "remote data".to_string(),
        Some(String::new()),
    ))
    .expect("encode send with empty summary");
    assert_eq!(empty["summary"], "");
}

#[test]
fn peer_push_frames_forward_payloads_verbatim() {
    let mut message_raw = message_json(Some(serde_json::json!("[summary] {{do_not_interpret}}")));
    message_raw["from"]["future_sender_field"] = serde_json::json!({"kept": true});
    message_raw["future_message_field"] = serde_json::json!(["kept", null, 7]);
    let frame: WireFrame = serde_json::from_value(serde_json::json!({
        "kind": "peer_message_received",
        "message": message_raw.clone()
    }))
    .expect("decode received-message push");
    let event = peer_event_from_frame(frame).expect("project received-message event");
    assert_eq!(event.name(), PEER_MESSAGE_RECEIVED_EVENT);
    let PeerWebviewEventV1::MessageReceived(payload) = event else {
        panic!("message push projected as delivery event");
    };
    assert_eq!(payload.message["message"], message_raw["message"]);
    assert_eq!(
        serde_json::to_value(payload).expect("serialize received-message event payload"),
        serde_json::json!({"message": message_raw})
    );

    let receipt_raw = serde_json::json!({
        "msg_id": "peer-message-1",
        "delivery": "future_relayed",
        "reason": "future_policy",
        "future_receipt_field": {"kept": [null, true]}
    });
    let frame: WireFrame = serde_json::from_value(serde_json::json!({
        "kind": "peer_delivery_changed",
        "receipt": receipt_raw.clone()
    }))
    .expect("decode delivery-change push");
    let event = peer_event_from_frame(frame).expect("project delivery-change event");
    assert_eq!(event.name(), PEER_DELIVERY_CHANGED_EVENT);
    let PeerWebviewEventV1::DeliveryChanged(payload) = event else {
        panic!("delivery push projected as message event");
    };
    assert_eq!(
        serde_json::to_value(payload).expect("serialize delivery-change event payload"),
        serde_json::json!({"receipt": receipt_raw})
    );
}

#[test]
fn peer_requests_responses_and_timestamps_match_966() {
    assert_eq!(FEATURE_PEER_MESSAGING_V1, "peer_messaging_v1");
    assert_eq!(PEER_MESSAGE_RECEIVED_EVENT, "peer-message-received");
    assert_eq!(PEER_DELIVERY_CHANGED_EVENT, "peer-delivery-changed");
    assert_eq!(
        serde_json::to_value(peer_list_request()).expect("encode peer.list"),
        serde_json::json!({"method": "peer.list"})
    );
    assert_eq!(
        serde_json::to_value(peer_name_request("new name".to_string())).expect("encode peer.name"),
        serde_json::json!({"method": "peer.name", "name": "new name"})
    );

    let list: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "peer.list",
        "agents": [descriptor_json("haider_session", "idle")]
    }))
    .expect("decode peer.list response");
    let list = peer_list_response(list).expect("project peer.list response");
    assert_eq!(list.agents.len(), 1);

    let name: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "peer.name",
        "agent": descriptor_json("haider_session", "busy")
    }))
    .expect("decode peer.name response");
    let name = peer_name_response(name).expect("project peer.name response");
    assert_eq!(name.name, "reviewer");

    let descriptor = serde_json::to_value(list.agents[0].clone()).expect("serialize descriptor");
    assert_eq!(descriptor["started_at"].as_u64(), Some(1_800_000_000_001));
    assert_eq!(descriptor["last_seen"].as_u64(), Some(1_800_000_000_999));
    let message = serde_json::to_value(
        serde_json::from_value::<PeerMessageV1>(message_json(None))
            .expect("decode timestamped message"),
    )
    .expect("serialize timestamped message");
    assert_eq!(message["queued_at"].as_u64(), Some(1_800_000_001_000));
    assert_eq!(message["expires_at"].as_u64(), Some(1_800_086_401_000));
}

#[test]
fn peer_ambiguity_candidates_survive_typed_error_data() {
    let body: ResponseBody = serde_json::from_value(serde_json::json!({
        "method": "error",
        "code": "peer_ambiguous",
        "message": "more than one live peer has that name",
        "retryable": false,
        "data": {
            "kind": "peer_ambiguous",
            "candidates": [
                {"id": "peer-1", "name": "reviewer"},
                {"id": "peer-2", "name": "reviewer"}
            ]
        }
    }))
    .expect("decode typed peer ambiguity");
    let error = peer_send_response(body).expect_err("ambiguous target must reject send");
    let Some(PeerErrorDataV1::PeerAmbiguous { candidates }) = error.data else {
        panic!("peer ambiguity candidates were flattened: {error:?}");
    };
    assert_eq!(candidates.len(), 2);
    assert_eq!(candidates[0].id, "peer-1");
    assert_eq!(candidates[1].id, "peer-2");
}

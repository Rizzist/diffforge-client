#![allow(clippy::expect_used)]

use super::*;

// Exact empty watch shape captured from the live 0.0.969 daemon for W8.3.
const WATCH_969: &[u8] = br#"{"v":1,"kind":"response","request_id":"w83-live-watch","body":{"method":"session.surface_watch","session_id":"session-143ba92a4284541770268f50a52ee225"}}"#;
const SESSION: &str = "session-143ba92a4284541770268f50a52ee225";
const WATCH_NEW: &[u8] = br#"{"v":1,"kind":"response","request_id":"watch-new","body":{"method":"session.surface_watch","session_id":"session-143ba92a4284541770268f50a52ee225","caller_owner":"caller:opaque/007","input":{"text":"same text","revision":9007199254740993,"owner":"foreign-publisher"},"status":{"line":"working","revision":18446744073709551615,"owner":"another-publisher"}}}"#;

fn connection(epoch: u64) -> ConnectionSnapshot {
    ConnectionSnapshot {
        connected: true,
        roster_identity: Some(RosterConnectionIdentity {
            profile_id: "surface-profile".into(),
            daemon_generation: 969,
            connection_serial: epoch,
        }),
        features: BTreeSet::from([
            FEATURE_INPUT_MIRROR_V1.into(),
            FEATURE_STATUS_SEGMENT_V1.into(),
        ]),
        capabilities_granted: BTreeSet::from([Capability::View]),
        frame_limit: DEFAULT_FRAME_LIMIT,
        ..ConnectionSnapshot::default()
    }
}

fn watching(bytes: &[u8]) -> (String, ResponseBody) {
    let WireFrame::Response { request_id, body } =
        decode_body(bytes, DEFAULT_FRAME_LIMIT).expect("decode watch fixture")
    else {
        panic!("expected watch response")
    };
    (request_id, body)
}

fn begin(state: &mut SurfaceWatchState, connection: &ConnectionSnapshot, request_id: &str) {
    state.begin(
        SESSION.into(),
        connection.roster_identity.clone().unwrap(),
        request_id.into(),
    );
}

fn input(owner: &str, revision: u64) -> Option<SurfaceInputWire> {
    Some(SurfaceInputWire {
        text: "same text".into(),
        attachments: Vec::new(),
        revision,
        owner: owner.into(),
    })
}

#[test]
fn surface_watch_caller_owner_crosses_tauri_verbatim_and_revisions_are_decimal() {
    // Exercise both negotiated encodings through the actual wire decoder.
    let frame = decode_body(WATCH_NEW, DEFAULT_FRAME_LIMIT).unwrap();
    for encoding in [WireEncoding::Json, WireEncoding::Msgpack] {
        let framed = encode_framed_with_encoding(&frame, DEFAULT_FRAME_LIMIT, encoding).unwrap();
        let WireFrame::Response { request_id, body } =
            decode_body_with_encoding(&framed[4..], DEFAULT_FRAME_LIMIT, encoding).unwrap()
        else {
            panic!("expected watch")
        };
        let conn = connection(1);
        let mut state = SurfaceWatchState::default();
        begin(&mut state, &conn, &request_id);
        let payload = state.adopt(&conn, &request_id, &body).expect("adopt watch");
        assert_eq!(
            serde_json::to_value(payload).unwrap(),
            serde_json::json!({
                "session_id": SESSION,
                "caller_owner": "caller:opaque/007",
                "input": { "text": "same text", "revision": "9007199254740993", "owner": "foreign-publisher" },
                "status": { "line": "working", "revision": "18446744073709551615" }
            })
        );
        // A foreign publisher with the same text/revision never renames us.
        let delta = state
            .delta(
                &conn,
                SESSION.into(),
                input("third-publisher", 9007199254740993),
                None,
            )
            .expect("foreign publisher has its own revision domain");
        let js = serde_json::to_value(delta).unwrap();
        assert_eq!(js["caller_owner"], "caller:opaque/007");
        assert_eq!(js["input"]["owner"], "third-publisher");
        assert_eq!(js["input"]["revision"], "9007199254740993");
    }
}

#[test]
fn surface_watch_969_absence_decodes_unchanged_and_is_not_inferred_from_delta() {
    let (request_id, body) = watching(WATCH_969);
    assert_eq!(
        serde_json::to_value(&body).unwrap(),
        serde_json::json!({
            "method": "session.surface_watch", "session_id": SESSION
        })
    );
    let conn = connection(1);
    let mut state = SurfaceWatchState::default();
    begin(&mut state, &conn, &request_id);
    let payload = state
        .adopt(&conn, &request_id, &body)
        .expect("empty baseline is emitted");
    assert_eq!(
        serde_json::to_value(payload).unwrap(),
        serde_json::json!({
            "session_id": SESSION, "input": null, "status": null
        })
    );
    let delta = state
        .delta(
            &conn,
            SESSION.into(),
            input("published-owner-is-not-caller", 1),
            None,
        )
        .unwrap();
    assert!(serde_json::to_value(delta)
        .unwrap()
        .get("caller_owner")
        .is_none());

    // The older complete snapshot shape with present input/status is also
    // supported, independently of whether this live empty session has them.
    let mut old: Value = serde_json::from_slice(WATCH_NEW).unwrap();
    old["body"].as_object_mut().unwrap().remove("caller_owner");
    let (request_id, body) = watching(&serde_json::to_vec(&old).unwrap());
    begin(&mut state, &conn, &request_id);
    let js = serde_json::to_value(state.adopt(&conn, &request_id, &body).unwrap()).unwrap();
    assert!(js.get("caller_owner").is_none());
    assert_eq!(js["input"]["owner"], "foreign-publisher");
    assert_eq!(js["status"]["revision"], u64::MAX.to_string());
}

#[test]
fn surface_watch_identity_only_adoption_is_emitted_and_legacy_rewatch_clears_identity() {
    let conn = connection(1);
    let mut state = SurfaceWatchState::default();
    for caller_owner in [None, Some(""), Some(" daemon/opaque:007 "), None] {
        begin(&mut state, &conn, "empty-watch");
        let body = ResponseBody::SessionSurfaceWatching {
            session_id: SESSION.into(),
            caller_owner: caller_owner.map(str::to_owned),
            input: None,
            status: None,
        };
        let js = serde_json::to_value(
            state
                .adopt(&conn, "empty-watch", &body)
                .expect("identity-only adoption"),
        )
        .unwrap();
        assert_eq!(js.get("caller_owner").and_then(Value::as_str), caller_owner);
        assert_eq!(js.get("caller_owner").is_some(), caller_owner.is_some());
        assert!(js["input"].is_null());
    }
}

#[test]
fn surface_watch_stale_epoch_response_and_delta_are_not_adopted() {
    let old = connection(1);
    let current = connection(2);
    let (request_id, body) = watching(WATCH_NEW);
    let mut state = SurfaceWatchState::default();
    begin(&mut state, &old, &request_id);
    state.adopt(&old, &request_id, &body).unwrap();
    // Reuse the request ID deliberately: this pins the epoch fence itself,
    // in addition to production send_surface_watch's epoch-qualified IDs.
    begin(&mut state, &current, &request_id);
    assert!(state.caller_owner.is_none());
    assert!(state.revision_gate.input.is_none());
    assert!(
        state.adopt(&old, &request_id, &body).is_none(),
        "stale epoch response must not be adopted"
    );
    assert!(
        state.pending_request.is_some(),
        "stale delivery must not consume the current watch"
    );
    assert!(state.caller_owner.is_none());
    state.adopt(&current, &request_id, &body).unwrap();
    assert!(state
        .delta(
            &old,
            SESSION.into(),
            input("stale-publisher", u64::MAX),
            None
        )
        .is_none());
    assert_eq!(
        state.revision_gate.input.as_ref().unwrap().owner,
        "foreign-publisher"
    );
    let payload = state
        .delta(
            &current,
            SESSION.into(),
            input("current-publisher", 1),
            None,
        )
        .unwrap();
    assert_eq!(payload.caller_owner.as_deref(), Some("caller:opaque/007"));
    assert_eq!(payload.input.unwrap().revision, 1);

    // Reconnect to a legacy peer cannot inherit the previous caller identity.
    let legacy = connection(3);
    let (request_id, body) = watching(WATCH_969);
    begin(&mut state, &legacy, &request_id);
    assert!(state
        .delta(&legacy, SESSION.into(), input("before-adoption", 1), None)
        .is_none());
    let js = serde_json::to_value(state.adopt(&legacy, &request_id, &body).unwrap()).unwrap();
    assert!(js.get("caller_owner").is_none());
    assert!(js["input"].is_null());
}

#[test]
fn surface_watch_session_request_profile_and_generation_must_match() {
    let conn = connection(1);
    let (request_id, body) = watching(WATCH_NEW);
    let mut state = SurfaceWatchState::default();
    begin(&mut state, &conn, &request_id);
    assert!(state.adopt(&conn, "unknown-request", &body).is_none());
    let mut mismatched = body.clone();
    let ResponseBody::SessionSurfaceWatching { session_id, .. } = &mut mismatched else {
        unreachable!()
    };
    *session_id = "another-session".into();
    assert!(state.adopt(&conn, &request_id, &mismatched).is_none());
    for variant in 0..3 {
        let mut wrong = conn.clone();
        match variant {
            0 => wrong.roster_identity.as_mut().unwrap().profile_id = "another-profile".into(),
            1 => wrong.roster_identity.as_mut().unwrap().daemon_generation += 1,
            _ => wrong.connected = false,
        }
        assert!(state.adopt(&wrong, &request_id, &body).is_none());
    }
    assert!(state.adopt(&conn, &request_id, &body).is_some());
    assert!(
        state.adopt(&conn, &request_id, &body).is_none(),
        "duplicate response"
    );
    assert!(state
        .delta(&conn, "another-session".into(), input("foreign", 1), None)
        .is_none());
    // Removing a subscription also removes its pending request/authority.
    let mut replacement = SurfaceWatchState::default();
    assert!(replacement.adopt(&conn, &request_id, &body).is_none());
}

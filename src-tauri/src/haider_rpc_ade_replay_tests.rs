#![allow(clippy::expect_used)]

use super::*;

fn attached(sealed_replay: Option<bool>, after: u64, through: u64) -> QueueReplayCursor {
    let mut cursor = QueueReplayCursor::new(after);
    cursor.begin_attach(sealed_replay);
    assert!(cursor.adopt(&AttachStateWire {
        session_id: "replay-session".into(),
        requested_after_seq: after,
        replay_through_seq: through,
        worker_generation: 1,
        authority_epoch: 1,
    }));
    cursor
}

fn apply(cursor: &mut QueueReplayCursor, seq: u64) -> Result<bool, String> {
    // Same gate and post-projection commit point as handle_queue_event.
    let accepted = cursor.should_apply(seq)?;
    if accepted {
        cursor.last_applied = seq;
    }
    Ok(accepted)
}

#[test]
fn sealed_replay_omissions_caught_up_and_contiguous_live_tail() {
    for encoding in [WireEncoding::Json, WireEncoding::Msgpack] {
        let mut cursor = attached(Some(true), 0, 8);
        let frames = [
            WireFrame::Event {
                attachment_id: "sealed".into(),
                session_id: "replay-session".into(),
                envelope: RawEnvelopeWire {
                    seq: 1,
                    session_id: "replay-session".into(),
                    payload: serde_json::json!({"type": "session_created"}),
                },
            },
            // 2..4 are omitted superseded deltas; 6..8 are trailing omissions.
            WireFrame::Event {
                attachment_id: "sealed".into(),
                session_id: "replay-session".into(),
                envelope: RawEnvelopeWire {
                    seq: 5,
                    session_id: "replay-session".into(),
                    payload: serde_json::json!({"type": "queue_changed", "revision": 5, "change": {"kind": "consumed", "id": "row"}}),
                },
            },
            WireFrame::AttachCaughtUp {
                attachment_id: "sealed".into(),
                high_water_seq: 8,
            },
            WireFrame::Event {
                attachment_id: "sealed".into(),
                session_id: "replay-session".into(),
                envelope: RawEnvelopeWire {
                    seq: 9,
                    session_id: "replay-session".into(),
                    payload: serde_json::json!({"type": "queue_changed", "revision": 9, "change": {"kind": "consumed", "id": "row-2"}}),
                },
            },
        ];
        let mut decoder = StreamingFrameDecoder::default();
        for frame in frames {
            decoder
                .push(&encode_framed_with_encoding(&frame, DEFAULT_FRAME_LIMIT, encoding).unwrap());
        }
        let mut forwarded = Vec::new();
        while let Some(frame) = decoder.next(DEFAULT_FRAME_LIMIT, encoding).unwrap() {
            match frame {
                WireFrame::Event { envelope, .. } => {
                    assert!(cursor
                        .should_apply(envelope.seq)
                        .expect("valid delivery must keep connection"));
                    if let Some(delta) =
                        parse_queue_changed_payload_owned(envelope.seq, envelope.payload).unwrap()
                    {
                        let value = serde_json::to_value(QueueEventEnvelopePayload {
                            seq: envelope.seq,
                            payload: delta,
                        })
                        .unwrap();
                        forwarded.push(value["seq"].as_u64().unwrap());
                    }
                    cursor.last_applied = envelope.seq;
                }
                WireFrame::AttachCaughtUp { high_water_seq, .. } => {
                    cursor
                        .caught_up(high_water_seq)
                        .expect("caught-up must keep connection");
                    assert_eq!(cursor.phase, QueueReplayPhase::Strict);
                    assert_eq!(cursor.last_applied, 8);
                }
                _ => panic!("unexpected fixture frame"),
            }
        }
        assert_eq!(forwarded, [5, 9]);
        assert_eq!(cursor.last_applied, 9);
    }
}

#[test]
fn sealed_replay_post_caught_up_gap_requires_repair_from_own_cursor() {
    let mut cursor = attached(Some(true), 0, 8);
    assert!(apply(&mut cursor, 5).unwrap());
    cursor.caught_up(8).unwrap();
    assert!(apply(&mut cursor, 9).unwrap());
    assert!(
        apply(&mut cursor, 11).is_err(),
        "live gap must request repair"
    );
    assert_eq!(
        cursor.last_applied, 9,
        "never resume from the rejected event"
    );
    cursor.begin_attach(Some(true));
    assert!(cursor.adopt(&AttachStateWire {
        session_id: "replay-session".into(),
        requested_after_seq: 9,
        replay_through_seq: 12,
        worker_generation: 1,
        authority_epoch: 1,
    }));
    assert!(apply(&mut cursor, 12).unwrap());
    cursor.caught_up(12).unwrap();
    assert!(apply(&mut cursor, 14).is_err());
}

#[test]
fn sealed_replay_never_allows_omissions_past_published_boundary() {
    let mut cursor = attached(Some(true), 0, 8);
    assert!(apply(&mut cursor, 5).unwrap());
    assert!(apply(&mut cursor, 9).is_err());
    assert!(cursor.caught_up(9).is_err());
    assert!(cursor.caught_up(7).is_err());
    assert_eq!(cursor.last_applied, 5);
    cursor.caught_up(8).unwrap();
    assert!(apply(&mut cursor, 9).unwrap());
}

#[test]
fn replay_duplicates_and_repeated_watermarks_never_regress_or_reapply() {
    for sealed in [None, Some(false), Some(true)] {
        let mut cursor = attached(sealed, 0, 2);
        assert!(apply(&mut cursor, 1).unwrap());
        assert!(!apply(&mut cursor, 1).unwrap());
        assert!(apply(&mut cursor, 2).unwrap());
        cursor.caught_up(2).unwrap();
        assert!(!apply(&mut cursor, 2).unwrap());
        assert!(apply(&mut cursor, 3).unwrap());
        cursor.caught_up(3).unwrap(); // published transparent repair boundary
        cursor.caught_up(2).unwrap(); // stale/duplicate cannot rewind
        assert_eq!(cursor.last_applied, 3);
        assert!(
            cursor.caught_up(5).is_err(),
            "watermark is not applied live data"
        );
        assert!(apply(&mut cursor, 5).is_err());
    }
}

#[test]
fn unsealed_replay_keeps_full_strictness_even_before_caught_up() {
    for sealed in [None, Some(false)] {
        let mut cursor = attached(sealed, 0, 8);
        assert!(apply(&mut cursor, 1).unwrap());
        assert!(apply(&mut cursor, 5).is_err());
        assert!(cursor.caught_up(8).is_err());
        assert_eq!(cursor.last_applied, 1);
    }
}

#[test]
fn sealed_replay_only_caught_up_can_cover_an_empty_or_trailing_omitted_replay() {
    let mut cursor = attached(Some(true), 2, 8);
    assert_eq!(
        cursor.last_applied, 2,
        "attach head is not delivered authority"
    );
    assert!(matches!(
        cursor.phase,
        QueueReplayPhase::SealedInitial { .. }
    ));
    cursor.caught_up(8).unwrap();
    assert_eq!(cursor.last_applied, 8);
    assert!(apply(&mut cursor, 9).unwrap());
    let mut empty = attached(Some(true), 8, 8);
    empty.caught_up(8).unwrap();
    assert!(apply(&mut empty, 10).is_err());
}

#[test]
fn replay_attach_cannot_replace_own_cursor_with_mismatched_echo() {
    let mut cursor = QueueReplayCursor::new(4);
    cursor.begin_attach(Some(true));
    for (requested_after_seq, replay_through_seq) in [(5, 8), (3, 8), (4, 3)] {
        assert!(!cursor.adopt(&AttachStateWire {
            session_id: "replay-session".into(),
            requested_after_seq,
            replay_through_seq,
            worker_generation: 1,
            authority_epoch: 1,
        }));
        assert_eq!(cursor.last_applied, 4);
        assert!(cursor.should_apply(6).is_err());
    }
}

#[test]
fn replay_cursors_above_js_integer_precision_remain_decimal() {
    let mut cursor = attached(Some(true), 9007199254740993, u64::MAX - 1);
    cursor.caught_up(u64::MAX - 1).unwrap();
    assert!(apply(&mut cursor, u64::MAX).unwrap());
    assert!(!apply(&mut cursor, u64::MAX).unwrap());
    // This lane introduces no Tauri cursor field. Preserve the existing
    // decimal boundary of typed durable facts forwarded by the same watch.
    let value = serde_json::to_value(AdeDurableFactEnvelopeV1 {
        session_id: "replay-session".into(),
        seq: cursor.last_applied,
        fact: AdeDurableFactV1::RunFailed(RunFailedHeadlessV1 {
            code: "budget_exhausted".into(),
            message: "fixture".into(),
            retryable: false,
            presentation: None,
        }),
    })
    .unwrap();
    assert_eq!(value["seq"], u64::MAX.to_string());
}

#[tokio::test]
#[ignore = "requires W84_REPLAY_SESSION created for this test and a running daemon; never starts/stops a daemon"]
async fn sealed_replay_live_two_simultaneous_surfaces() {
    let session = std::env::var("W84_REPLAY_SESSION").expect("explicit disposable session");
    let path = resolve_socket_path().expect("published daemon endpoint");
    let mut surfaces = Vec::new();
    for surface in 0..2 {
        let (mut stream, welcome) = connect_and_handshake(&path).await.unwrap();
        assert!(welcome.features.contains(FEATURE_SESSION_ATTACH_SEALED_V1));
        let encoding = WireEncoding::from_welcome(&welcome).unwrap();
        println!(
            "LIVE surface={surface} daemon={} session={session} encoding={encoding:?}",
            welcome.daemon_version
        );
        let mut cursor = QueueReplayCursor::new(0);
        cursor.begin_attach(Some(true));
        write_frame(
            &mut stream,
            &WireFrame::Request {
                request_id: format!("w84-attach-{surface}"),
                body: RequestBody::SessionAttach {
                    session_id: session.clone(),
                    after_seq: 0,
                    mode: AttachMode::Control,
                    sealed_replay: Some(true),
                },
            },
            DEFAULT_FRAME_LIMIT,
            encoding,
        )
        .await
        .unwrap();
        let mut attachment = None;
        loop {
            let frame = live_frame(&mut stream, encoding).await;
            match frame {
                WireFrame::Response {
                    body:
                        ResponseBody::SessionAttach {
                            attachment_id,
                            attach_state,
                        },
                    ..
                } => {
                    assert_eq!(attach_state.session_id, session);
                    assert!(cursor.adopt(&attach_state));
                    println!(
                        "LIVE surface={surface} attachment={attachment_id} replay_through={}",
                        attach_state.replay_through_seq
                    );
                    attachment = Some(attachment_id);
                }
                WireFrame::Event {
                    attachment_id,
                    session_id,
                    envelope,
                } => {
                    assert_eq!(Some(attachment_id), attachment);
                    assert_eq!(session_id, session);
                    assert_eq!(envelope.session_id, session);
                    assert!(apply(&mut cursor, envelope.seq).unwrap());
                    println!("LIVE surface={surface} applied={}", envelope.seq);
                }
                WireFrame::AttachCaughtUp {
                    attachment_id,
                    high_water_seq,
                } => {
                    assert_eq!(Some(attachment_id), attachment);
                    cursor.caught_up(high_water_seq).unwrap();
                    assert_eq!(cursor.phase, QueueReplayPhase::Strict);
                    println!("LIVE surface={surface} caught_up={high_water_seq}");
                    break;
                }
                WireFrame::Ping { nonce } => write_frame(
                    &mut stream,
                    &WireFrame::Pong { nonce },
                    DEFAULT_FRAME_LIMIT,
                    encoding,
                )
                .await
                .unwrap(),
                WireFrame::ResidentSessionBinding { .. } => {}
                WireFrame::ProtocolError(error) if !error.fatal => {}
                other => panic!("unexpected live frame: {}", wire_frame_kind(&other)),
            }
        }
        surfaces.push((stream, encoding, cursor));
    }
    // Both real attachments remain open simultaneously. Published Pong frames,
    // not a quiet socket, prove that each connection still responds.
    for nonce in 1..=3 {
        for (surface, (stream, encoding, _)) in surfaces.iter_mut().enumerate() {
            write_frame(
                stream,
                &WireFrame::Ping { nonce },
                DEFAULT_FRAME_LIMIT,
                *encoding,
            )
            .await
            .unwrap();
            loop {
                match live_frame(stream, *encoding).await {
                    WireFrame::Pong { nonce: received } => {
                        assert_eq!(received, nonce);
                        break;
                    }
                    WireFrame::Ping { nonce } => write_frame(
                        stream,
                        &WireFrame::Pong { nonce },
                        DEFAULT_FRAME_LIMIT,
                        *encoding,
                    )
                    .await
                    .unwrap(),
                    WireFrame::ResidentSessionBinding { .. } => {}
                    other => panic!("unexpected live tail: {}", wire_frame_kind(&other)),
                }
            }
            println!("LIVE simultaneous_surface={surface} pong={nonce}");
        }
    }
}

async fn live_frame(stream: &mut UnixStream, encoding: WireEncoding) -> WireFrame {
    tokio::time::timeout(Duration::from_secs(10), async {
        let mut prefix = [0; 4];
        stream.read_exact(&mut prefix).await.unwrap();
        let len = u32::from_be_bytes(prefix) as usize;
        assert!(len > 0 && len <= DEFAULT_FRAME_LIMIT);
        let mut bytes = vec![0; len];
        stream.read_exact(&mut bytes).await.unwrap();
        decode_body_with_encoding(&bytes, DEFAULT_FRAME_LIMIT, encoding).unwrap()
    })
    .await
    .expect("live daemon response deadline")
}

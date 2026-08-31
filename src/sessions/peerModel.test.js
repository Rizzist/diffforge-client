import assert from "node:assert/strict";
import test from "node:test";

import {
  deliveryView,
  peerDescriptorView,
  peerMessageView,
  peerUnavailableFromError,
  sendArgs,
} from "./peerModel.js";

function received(overrides = {}) {
  return {
    msg_id: "msg-daemon-1",
    from: {
      id: "peer-9",
      name: "build-peer",
      kind: "haider_session",
      trust: "verified_haider",
    },
    to: "this-client",
    message: "plain remote text",
    queued_at: "2026-08-31T10:00:00Z",
    expires_at: "2026-08-31T11:00:00Z",
    ...overrides,
  };
}

test("[pin] trust is fail-closed: unknown and absent trust are visibly untrusted", () => {
  const verified = peerMessageView(received());
  assert.equal(verified.from.trust.trusted, true);
  assert.equal(verified.from.trust.kind, "verified");

  const external = peerMessageView(received({
    from: { id: "external-1", name: "outside", kind: "external", trust: "untrusted_external" },
  }));
  assert.equal(external.from.trust.trusted, false);
  assert.equal(external.from.trust.recognized, true);
  assert.match(external.from.trust.label, /UNTRUSTED/);

  const future = peerMessageView(received({
    from: { id: "future-1", name: "future", kind: "external", trust: "federated_maybe" },
  }));
  assert.deepEqual(future.from.trust, {
    kind: "unknown",
    raw: "federated_maybe",
    label: "UNTRUSTED · federated_maybe (unrecognized trust)",
    recognized: false,
    trusted: false,
  });

  const absent = peerMessageView(received({
    from: { id: "missing-1", name: "missing", kind: "external" },
  }));
  assert.equal(absent.from.trust.trusted, false);
  assert.equal(absent.from.trust.kind, "absent");
  assert.match(absent.from.trust.label, /UNTRUSTED/);
});

test("[pin] queued is distinct from delivered and absent reasons stay absent", () => {
  const queued = deliveryView({ delivery: "queued" });
  const delivered = deliveryView({ delivery: "delivered" });
  assert.equal(queued.state.raw, "queued");
  assert.equal(delivered.state.raw, "delivered");
  assert.notDeepEqual(queued.state, delivered.state);
  assert.equal(queued.reason, null);
  assert.equal(delivered.reason, null);

  const refused = deliveryView({ delivery: "refused", reason: "target_refused" });
  assert.equal(refused.state.raw, "refused");
  assert.equal(refused.reason.raw, "target_refused");
  assert.equal(refused.reason.recognized, true);

  const expired = deliveryView({ delivery: "expired", reason: "deadline_elapsed" });
  assert.equal(expired.state.raw, "expired");
  assert.equal(expired.reason.raw, "deadline_elapsed");
});

test("[pin] unknown peer and delivery enums survive raw and marked unrecognized", () => {
  const peer = peerDescriptorView({
    id: "peer-future",
    name: "future peer",
    kind: "relay_collective",
    state: "hibernating",
    workspace: "/work",
    model: "future-model",
  });
  assert.deepEqual(peer.kind, {
    kind: "unknown",
    raw: "relay_collective",
    label: "relay_collective",
    recognized: false,
  });
  assert.equal(peer.state.raw, "hibernating");
  assert.equal(peer.state.recognized, false);

  const delivery = deliveryView({
    delivery: "teleported",
    reason: "wormhole_closed",
  });
  assert.equal(delivery.state.raw, "teleported");
  assert.equal(delivery.state.recognized, false);
  assert.equal(delivery.reason.raw, "wormhole_closed");
  assert.equal(delivery.reason.recognized, false);
});

test("[pin] summary omission differs from an explicitly empty summary", () => {
  assert.deepEqual(sendArgs("peer-1", "hello"), {
    to: "peer-1",
    message: "hello",
  });
  assert.equal(Object.hasOwn(sendArgs("peer-1", "hello"), "summary"), false);
  assert.equal(Object.hasOwn(sendArgs("peer-1", "hello", undefined), "summary"), false);
  assert.equal(Object.hasOwn(sendArgs("peer-1", "hello", null), "summary"), false);
  assert.deepEqual(sendArgs("peer-1", "hello", ""), {
    to: "peer-1",
    message: "hello",
    summary: "",
  });
  assert.deepEqual(sendArgs("peer-1", "hello", "context"), {
    to: "peer-1",
    message: "hello",
    summary: "context",
  });

  const absent = peerMessageView(received());
  const empty = peerMessageView(received({ summary: "" }));
  assert.equal(absent.hasSummary, false);
  assert.equal(absent.summary, null);
  assert.equal(empty.hasSummary, true);
  assert.equal(empty.summary, "");
});

test("[pin] message ids and delivery state come only from daemon publications", () => {
  const message = peerMessageView(received());
  assert.equal(message.msgId, "msg-daemon-1");
  assert.equal(peerMessageView(received({ msg_id: undefined })).msgId, null);

  const receipt = deliveryView({ delivery: "queued" });
  assert.equal(receipt.state.raw, "queued");
  assert.notEqual(receipt.state.raw, "delivered");
});

test("peerUnavailableFromError reuses the shared feature-gate detector", () => {
  assert.equal(peerUnavailableFromError(
    new Error("missing_feature: daemon does not advertise peer_messaging_v1"),
  ), true);
  assert.equal(peerUnavailableFromError("does not advertise peer.list"), true);
  assert.equal(peerUnavailableFromError(new Error("connection reset")), false);
});

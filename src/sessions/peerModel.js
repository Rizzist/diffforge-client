import { lifecycleUnavailableFromError } from "./lifecycleModel.js";

/* Pure peer-messaging views. The daemon owns every identity, trust label,
   message id, and delivery fact. This module only classifies published enum
   values for display and preserves future values verbatim. */

const KNOWN_PEER_KINDS = new Set(["haider_session", "external"]);
const KNOWN_PEER_STATES = new Set(["idle", "busy"]);
const KNOWN_DELIVERIES = new Set([
  "queued",
  "delivered",
  "expired",
  "refused",
]);
const KNOWN_DELIVERY_REASONS = new Set([
  "deadline_elapsed",
  "target_never_returned",
  "target_unavailable",
  "target_refused",
  "invalid_message",
]);

function owns(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function stringOrNull(value) {
  return typeof value === "string" ? value : null;
}

function nonEmptyStringOrNull(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function categoryView(value, knownValues) {
  if (typeof value !== "string") {
    return {
      kind: "absent",
      raw: null,
      label: "not published",
      recognized: false,
    };
  }
  if (knownValues.has(value)) {
    return { kind: "known", raw: value, label: value, recognized: true };
  }
  return { kind: "unknown", raw: value, label: value, recognized: false };
}

/* One peer-list descriptor. Unknown kind/state values remain raw and carry
   recognized:false so the panel can mark them rather than dropping them or
   styling them as a known value. */
export function peerDescriptorView(descriptor) {
  return {
    id: nonEmptyStringOrNull(descriptor?.id),
    name: stringOrNull(descriptor?.name),
    kind: categoryView(descriptor?.kind, KNOWN_PEER_KINDS),
    workspace: stringOrNull(descriptor?.workspace),
    model: stringOrNull(descriptor?.model),
    state: categoryView(descriptor?.state, KNOWN_PEER_STATES),
    startedAt: descriptor?.started_at ?? null,
    lastSeen: descriptor?.last_seen ?? null,
  };
}

/* Trust is fail-closed. Only the one explicit verified_haider value is
   trusted. untrusted_external is a recognized untrusted value; every future,
   malformed, or absent value is ALSO untrusted and visibly unrecognized. */
export function peerTrustView(value) {
  if (value === "verified_haider") {
    return {
      kind: "verified",
      raw: value,
      label: "Verified Haider",
      recognized: true,
      trusted: true,
    };
  }
  if (value === "untrusted_external") {
    return {
      kind: "untrusted",
      raw: value,
      label: "UNTRUSTED external",
      recognized: true,
      trusted: false,
    };
  }
  if (typeof value === "string") {
    return {
      kind: "unknown",
      raw: value,
      label: `UNTRUSTED · ${value} (unrecognized trust)`,
      recognized: false,
      trusted: false,
    };
  }
  return {
    kind: "absent",
    raw: null,
    label: "UNTRUSTED · trust not published",
    recognized: false,
    trusted: false,
  };
}

/* A received peer message. Message and summary remain ordinary strings for
   React text-node rendering; nothing here interprets either as markup or an
   instruction. hasSummary preserves absent versus explicitly empty. */
export function peerMessageView(message) {
  const hasSummary = owns(message, "summary");
  return {
    msgId: nonEmptyStringOrNull(message?.msg_id),
    from: {
      id: nonEmptyStringOrNull(message?.from?.id),
      name: stringOrNull(message?.from?.name),
      kind: categoryView(message?.from?.kind, KNOWN_PEER_KINDS),
      trust: peerTrustView(message?.from?.trust),
    },
    to: stringOrNull(message?.to),
    message: stringOrNull(message?.message) ?? "",
    hasSummary,
    summary: hasSummary ? stringOrNull(message?.summary) : null,
    queuedAt: message?.queued_at ?? null,
    expiresAt: message?.expires_at ?? null,
  };
}

/* Delivery state and its optional reason are separate published facts.
   queued never aliases delivered. An absent reason is null (and therefore
   renders nothing); an unknown state/reason retains its raw spelling with
   recognized:false. */
export function deliveryView(receipt) {
  return {
    state: categoryView(receipt?.delivery, KNOWN_DELIVERIES),
    reason: owns(receipt, "reason")
      ? categoryView(receipt?.reason, KNOWN_DELIVERY_REASONS)
      : null,
  };
}

/* summary omission is a wire fact. undefined/null mean absent and omit the
   key; an explicitly supplied empty string remains a present empty summary.
   The panel uses the two-argument path for its untouched/blank optional
   field, while callers that truly publish "" can still do so. */
export function sendArgs(to, message, summary) {
  const args = { to, message };
  if (summary !== undefined && summary !== null) args.summary = summary;
  return args;
}

/* Peer messaging shares the shipped feature-gate vocabulary with the other
   session SDK surfaces, including String throws. */
export function peerUnavailableFromError(error) {
  return lifecycleUnavailableFromError(error);
}

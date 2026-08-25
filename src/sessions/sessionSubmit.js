export const DELIVERY_MODES = Object.freeze([
  Object.freeze({
    value: "queue",
    label: "Queue",
    detail: "Hold until the current turn finishes.",
  }),
  Object.freeze({
    value: "steer",
    label: "Steer",
    detail: "Deliver at the next safe boundary.",
  }),
  Object.freeze({
    value: "subturn",
    label: "Subturn",
    detail: "Schedule as a separate subturn.",
  }),
]);

const DELIVERY_MODE_PRESENTATIONS = new Map(
  DELIVERY_MODES.map((mode) => [mode.value, mode]),
);
const SUBMIT_DISPOSITION_PRESENTATIONS = Object.freeze({
  started: { label: "Started", detail: "The turn started." },
  queued: { label: "Queued", detail: "Held until the active turn finishes." },
  steer_pending: { label: "Steer pending", detail: "Waiting for a safe delivery boundary." },
  subturn_pending: { label: "Subturn pending", detail: "Scheduled as a separate subturn." },
  unknown: {
    label: "Accepted",
    detail: "The daemon did not publish this submission's disposition.",
  },
});

export function isDeliveryMode(value) {
  return DELIVERY_MODE_PRESENTATIONS.has(value);
}

export function normalizeDeliveryMode(value) {
  return isDeliveryMode(value) ? value : "queue";
}

export function deliveryModePresentation(value) {
  return DELIVERY_MODE_PRESENTATIONS.get(normalizeDeliveryMode(value));
}

/* SubmitDisposition is unknown-tolerant on the wire. An absent or future
   value means exactly that: acceptance was observed, but its worker
   disposition was not. It must never be promoted to `started` from the
   selected delivery mode or from local run state. */
export function normalizeSubmitDisposition(value) {
  return Object.hasOwn(SUBMIT_DISPOSITION_PRESENTATIONS, value) ? value : "unknown";
}

export function submitDispositionPresentation(value) {
  const disposition = normalizeSubmitDisposition(value);
  return { disposition, ...SUBMIT_DISPOSITION_PRESENTATIONS[disposition] };
}

export function tauriResponseBody(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.body && typeof value.body === "object" && !Array.isArray(value.body)) {
    return value.body;
  }
  return value;
}

/* This is the deliberately narrow Tauri seam. The Rust lane can change how
   the command reaches turn.submit without making the composer understand the
   wire. Tests inject `invokeCommand`; production passes Tauri's invoke. */
export async function submitSessionPrompt(invokeCommand, {
  sessionId,
  prompt,
  attachments = [],
  mode,
}) {
  /* An omitted mode is compatibility-significant: it is the legacy submit
     shape used when queue_control_v1 is absent. Never turn absence into an
     explicit Queue request at this boundary. */
  const deliveryMode = mode == null ? undefined : normalizeDeliveryMode(mode);
  const response = await invokeCommand("session_submit_prompt", {
    session_id: sessionId,
    prompt,
    attachments: attachments.length ? attachments : null,
    ...(deliveryMode === undefined ? {} : { mode: deliveryMode }),
  });
  const receipt = tauriResponseBody(response);
  const presentation = submitDispositionPresentation(receipt?.disposition);
  return {
    ...presentation,
    mode: deliveryMode,
    receipt,
  };
}

export function ownSubmissionConfirmation(result, text, now = Date.now()) {
  const presentation = submitDispositionPresentation(result?.disposition);
  return {
    id: `submission-${now}`,
    text: typeof text === "string" ? text : "",
    mode: normalizeDeliveryMode(result?.mode),
    createdAtMs: now,
    ...presentation,
  };
}

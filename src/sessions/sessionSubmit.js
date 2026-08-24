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

const DELIVERY_MODE_VALUES = new Set(DELIVERY_MODES.map((mode) => mode.value));
const SUBMIT_DISPOSITIONS = new Set([
  "started",
  "queued",
  "steer_pending",
  "subturn_pending",
]);

export function normalizeDeliveryMode(value) {
  return DELIVERY_MODE_VALUES.has(value) ? value : "queue";
}

/* SubmitDisposition is unknown-tolerant on the wire. An absent or future
   value means exactly that: acceptance was observed, but its worker
   disposition was not. It must never be promoted to `started` from the
   selected delivery mode or from local run state. */
export function normalizeSubmitDisposition(value) {
  return SUBMIT_DISPOSITIONS.has(value) ? value : "unknown";
}

export function submitDispositionPresentation(value) {
  const disposition = normalizeSubmitDisposition(value);
  switch (disposition) {
    case "started":
      return { disposition, label: "Started", detail: "The turn started." };
    case "queued":
      return { disposition, label: "Queued", detail: "Held until the active turn finishes." };
    case "steer_pending":
      return { disposition, label: "Steer pending", detail: "Waiting for a safe delivery boundary." };
    case "subturn_pending":
      return { disposition, label: "Subturn pending", detail: "Scheduled as a separate subturn." };
    default:
      return {
        disposition: "unknown",
        label: "Accepted",
        detail: "The daemon did not publish this submission's disposition.",
      };
  }
}

function receiptBody(value) {
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
  mode = "queue",
}) {
  const deliveryMode = normalizeDeliveryMode(mode);
  const response = await invokeCommand("session_submit_prompt", {
    session_id: sessionId,
    prompt,
    attachments: attachments.length ? attachments : null,
    mode: deliveryMode,
  });
  const receipt = receiptBody(response);
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

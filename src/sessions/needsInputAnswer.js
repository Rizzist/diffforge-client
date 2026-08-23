export const NEEDS_INPUT_NO_CONNECTION = "haider_needs_input_no_connection";
export const NEEDS_INPUT_FEATURE_MISSING = "haider_needs_input_feature_missing";
export const NEEDS_INPUT_RPC_FAILED = "haider_needs_input_rpc_failed";

/* Calls occur at 0, .7, 1.4, ... 5.6 seconds. The final attempt therefore
   happens after the RPC actor's current maximum five-second reconnect
   backoff, and every disconnected attempt asks that actor to reconnect. */
export const NEEDS_INPUT_RECONNECT_DELAYS_MS = Object.freeze(
  Array.from({ length: 8 }, () => 700),
);

export function needsInputFailureText(failure) {
  return String(failure?.message || failure || "").trim();
}

export function needsInputFailureCode(failure) {
  return needsInputFailureText(failure).split(":", 1)[0].trim();
}

export function needsInputFailureMessage(failure, fallback = "The answer did not go through.") {
  const text = needsInputFailureText(failure);
  const code = needsInputFailureCode(failure);
  if (code === NEEDS_INPUT_NO_CONNECTION) {
    return "No live connection to the Haider daemon. Start or restart Haider; opening the Shell cannot restore this RPC route.";
  }
  if (code === NEEDS_INPUT_FEATURE_MISSING) {
    return "The connected Haider daemon does not support answering this card. Update Haider; opening the Shell cannot add this feature.";
  }
  if (code === NEEDS_INPUT_RPC_FAILED) {
    return "DiffForge reached Haider, but could not list or attach this session. Opening the Shell cannot fix this RPC failure.";
  }
  /* Older side actions still collapse their RPC failures into this legacy
     code. Do not invent a connection diagnosis from it. */
  if (code === "haider_needs_input_unavailable") {
    return "DiffForge could not complete this Haider RPC request. Opening the Shell cannot restore the RPC route.";
  }
  if (code === "haider_needs_input_answer_uncertain") {
    return "The reply may not have been confirmed — pressing again is safe.";
  }
  if (code === "haider_needs_input_stale") {
    return "This request moved on — the current one will appear here.";
  }
  if (code === "already_resolved") {
    return "Already answered — this park has closed.";
  }
  return text || fallback;
}

export function isNeedsInputCardAnswerable(card) {
  return typeof card?.menu_id === "string"
    && card.menu_id.length > 0
    && typeof card?.request_seq === "number"
    && Number.isFinite(card.request_seq)
    && typeof card?.worker_generation === "number"
    && Number.isFinite(card.worker_generation)
    && Array.isArray(card?.options)
    && card.options.length > 0;
}

function wait(delayMs) {
  return new Promise((resolve) => { globalThis.setTimeout(resolve, delayMs); });
}

export async function answerNeedsInputWithReconnect({
  invokeAnswer,
  onReconnect = null,
  sleep = wait,
}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await invokeAnswer();
    } catch (failure) {
      const delayMs = NEEDS_INPUT_RECONNECT_DELAYS_MS[attempt];
      if (needsInputFailureCode(failure) !== NEEDS_INPUT_NO_CONNECTION
        || delayMs === undefined) {
        throw failure;
      }
      onReconnect?.();
      await sleep(delayMs);
    }
  }
}

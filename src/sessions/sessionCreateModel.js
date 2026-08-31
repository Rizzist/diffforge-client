import { lifecycleUnavailableFromError } from "./lifecycleModel.js";

const DECIMAL_STRING = /^\d+$/;
const INTERACTION_MODES = new Set(["interactive", "autonomous"]);
const ADMISSION_REJECTIONS = new Set([
  "provider_unavailable",
  "model_unknown",
  "effort_unsupported",
  "fast_unsupported",
]);
const ADMISSION_PENDING = new Set([
  "queued",
  "deferred",
  "pending",
  "admission_queued",
  "admission_deferred",
  "admission_pending",
]);
const CREATE_UNAVAILABLE_CODES = new Set([
  "missing_feature",
  "not_implemented",
  "unavailable",
  "unsupported",
]);

function own(object, key) {
  return Boolean(object && typeof object === "object" && Object.hasOwn(object, key));
}

function nonEmptyString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return Object.keys(value).length > 0 ? value : undefined;
}

/* session.create has four required coordinates in the shipped SDK. Optional
   values are added only when the caller made a choice; in particular, the
   daemon's interaction default remains an omitted key. */
export function createArgs(draft = {}, options = {}) {
  const interactionMode = nonEmptyString(options.interactionMode ?? options.interaction_mode);
  const permissionOverrides = optionalObject(
    options.permissionOverrides ?? options.permission_overrides,
  );
  const cachePolicy = optionalObject(options.cachePolicy ?? options.cache_policy);
  const admission = optionalObject(options.admission);
  return {
    cwd: typeof draft.cwd === "string" ? draft.cwd : "",
    provider: nonEmptyString(draft.provider),
    model: nonEmptyString(draft.model),
    max_tokens: options.maxTokens ?? options.max_tokens
      ?? draft.maxTokens ?? draft.max_tokens,
    ...(permissionOverrides === undefined
      ? {}
      : { permission_overrides: permissionOverrides }),
    ...(cachePolicy === undefined ? {} : { cache_policy: cachePolicy }),
    ...(INTERACTION_MODES.has(interactionMode)
      ? { interaction_mode: interactionMode }
      : {}),
    ...(admission === undefined ? {} : { admission }),
  };
}

function decimalString(value) {
  return typeof value === "string" && DECIMAL_STRING.test(value) ? value : null;
}

/* Every identity and durable coordinate is copied from the receipt. Numeric
   lookalikes are rejected because they may already have lost precision before
   reaching this boundary. metadata deliberately remains opaque. */
export function createReceiptView(receipt) {
  return {
    sessionId: nonEmptyString(receipt?.session_id) || null,
    createdSeq: decimalString(receipt?.created_seq),
    workerGeneration: decimalString(receipt?.worker_generation),
    metadata: own(receipt, "metadata") ? receipt.metadata : undefined,
    raw: receipt ?? null,
  };
}

function normalizedToken(value) {
  return nonEmptyString(value).toLowerCase().replace(/[ .-]+/g, "_");
}

function admissionFallbackReason(kind, data) {
  const provider = nonEmptyString(data?.provider);
  const model = nonEmptyString(data?.model);
  if (kind === "provider_unavailable") {
    return provider ? `Provider “${provider}” is unavailable.` : "The selected provider is unavailable.";
  }
  if (kind === "model_unknown") {
    const coordinate = [provider, model].filter(Boolean).join("/");
    return coordinate ? `Model “${coordinate}” is not in the daemon inventory.` : "The selected model is unknown.";
  }
  if (kind === "effort_unsupported") {
    const effort = nonEmptyString(data?.effort);
    return effort ? `Effort “${effort}” is unsupported for the selected model.` : "The selected effort is unsupported.";
  }
  if (kind === "fast_unsupported") {
    return "Fast mode is unsupported for the selected model.";
  }
  return "The daemon did not publish a readable admission reason.";
}

/* Admission is an error outcome in 967. Known rejections stay rejected,
   future queued/deferred forms stay pending, and future structured data is
   retained raw instead of being mislabeled as either success or rejection. */
export function admissionView(error) {
  const raw = error ?? null;
  const object = error && typeof error === "object" && !Array.isArray(error) ? error : null;
  const data = object?.data && typeof object.data === "object" && !Array.isArray(object.data)
    ? object.data
    : null;
  const dataKind = normalizedToken(data?.kind ?? data?.status ?? data?.outcome);
  const code = normalizedToken(object?.code);
  const kind = dataKind || code;
  const message = nonEmptyString(object?.message);

  if (ADMISSION_PENDING.has(kind) || /(?:^|_)queue(?:d)?$|deferred|pending/.test(kind)) {
    return {
      state: "pending",
      reason: message || "The daemon deferred session creation.",
      kind: kind || null,
      data,
      raw,
      admission: true,
    };
  }
  if (ADMISSION_REJECTIONS.has(kind)) {
    return {
      state: "rejected",
      reason: message || admissionFallbackReason(kind, data),
      kind,
      data,
      raw,
      admission: true,
    };
  }
  if (data) {
    return {
      state: "unknown",
      reason: message || "The daemon returned an unrecognized admission outcome.",
      kind: kind || null,
      data,
      raw,
      admission: true,
    };
  }
  return {
    state: "unknown",
    reason: message || nonEmptyString(error) || "Session creation failed without a typed reason.",
    kind: kind || null,
    data: null,
    raw,
    admission: false,
  };
}

/* Reuse the shared shipped feature-gate detector, but never let admission
   wording such as provider_unavailable trigger the legacy CLI fallback. */
export function createUnavailableFromError(error) {
  const message = String(error?.message ?? error ?? "").trim();
  if (/^Command\s+ade_session_create\s+not found$/i.test(message)) {
    return true;
  }
  if (error && typeof error === "object" && !Array.isArray(error)) {
    if (error.data != null) return false;
    const code = normalizedToken(error.code);
    if (code) {
      return CREATE_UNAVAILABLE_CODES.has(code)
        || /missing_feature|unavailable|unsupported|not_implemented|unknown_(?:command|method)/.test(code);
    }
  }
  return lifecycleUnavailableFromError(error);
}

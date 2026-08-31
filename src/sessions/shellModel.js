import { lifecycleUnavailableFromError } from "./lifecycleModel.js";

/* Pure views for the unified shell registry. The daemon owns shell identity,
   scope, lifecycle state, command coordinates, and output bytes. Unknown
   enum values remain visible as raw values; absent scope is never defaulted
   to local execution. */

const KNOWN_KINDS = new Set(["local", "ssh"]);
const KNOWN_SCOPES = new Set(["local", "ssh"]);
const KNOWN_STATES = new Set(["starting", "running", "exited", "closed"]);
const KNOWN_STREAMS = new Set(["stdout", "stderr"]);

export const SHELL_OUTPUT_TRANSIENT_NOTICE =
  "Live output is connection-transient. Buffered output starts when this subscription began; output before this point was not captured.";

function owns(value, key) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function stringOrNull(value) {
  return typeof value === "string" ? value : null;
}

function nonEmptyStringOrNull(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function publishedOrNull(value) {
  return value === undefined || value === null ? null : value;
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

function nestedString(value, keys) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  for (const key of keys) {
    if (typeof value[key] === "string") return value[key];
  }
  return null;
}

/* ShellWire has shipped nested kind/status records, while additive daemon
   versions may publish direct kind/scope/state strings. Read either spelling
   without deriving one category from another. */
export function shellRowView(row) {
  const kindRaw = nestedString(row?.kind, ["kind"]);
  const scopeRaw = nestedString(row?.scope, ["scope", "kind"]);
  const stateRaw = nestedString(row?.state, ["state", "status"])
    ?? nestedString(row?.status, ["status", "state"]);
  const kindProfile = row?.kind && typeof row.kind === "object"
    ? stringOrNull(row.kind.profile)
    : null;
  const scopeProfile = row?.scope && typeof row.scope === "object"
    ? stringOrNull(row.scope.profile)
    : null;
  const stateRecord = row?.state && typeof row.state === "object"
    ? row.state
    : row?.status && typeof row.status === "object" ? row.status : null;

  return {
    id: nonEmptyStringOrNull(row?.id ?? row?.shell_id),
    kind: categoryView(kindRaw, KNOWN_KINDS),
    scope: categoryView(scopeRaw, KNOWN_SCOPES),
    state: categoryView(stateRaw, KNOWN_STATES),
    title: stringOrNull(row?.title),
    cwd: stringOrNull(row?.cwd),
    cwdOrHost: stringOrNull(row?.cwd_or_host),
    sessionId: nonEmptyStringOrNull(row?.session_id),
    branchId: nonEmptyStringOrNull(row?.branch_id),
    profile: stringOrNull(row?.ssh_profile) ?? kindProfile ?? scopeProfile,
    exitCode: owns(row, "exit_code")
      ? publishedOrNull(row.exit_code)
      : publishedOrNull(stateRecord?.code),
    createdAtMs: publishedOrNull(row?.created_at_ms),
    lastActivityMs: publishedOrNull(row?.last_activity_ms),
    bytesOut: publishedOrNull(row?.bytes_out),
  };
}

/* run_id is an Option on the shipped receipt. Its absence remains a typed,
   visible absence instead of being filled from item_id, session_id, or a
   locally generated identifier. Sequence coordinates remain verbatim. */
export function execReceiptView(receipt) {
  const runIdPublished = owns(receipt, "run_id")
    && typeof receipt.run_id === "string";
  const runId = runIdPublished ? receipt.run_id : null;
  return {
    sessionId: nonEmptyStringOrNull(receipt?.session_id),
    itemId: nonEmptyStringOrNull(receipt?.item_id),
    acceptedSeq: publishedOrNull(receipt?.accepted_seq),
    workerGeneration: publishedOrNull(receipt?.worker_generation),
    runId,
    runIdPublished,
    runIdLabel: runIdPublished
      ? (runId === "" ? "empty run id published" : runId)
      : "no run id published",
  };
}

/* shell.close is idempotent. Every resolved receipt is a normal daemon
   outcome, including an explicit already_closed outcome or a returned row
   whose published state is closed. The view does not force any other state
   to closed. */
export function closeOutcomeView(receipt) {
  const shellSource = receipt?.shell ?? receipt?.row
    ?? (receipt?.id != null || receipt?.shell_id != null ? receipt : null);
  const shell = shellSource == null ? null : shellRowView(shellSource);
  const alreadyClosed = receipt?.already_closed === true
    || receipt?.outcome === "already_closed";
  return {
    kind: alreadyClosed || shell?.state.raw === "closed" ? "closed" : "published",
    normal: true,
    alreadyClosed,
    shell,
  };
}

function decodeBase64Text(value) {
  if (typeof value !== "string") return { text: null, decoded: false };
  try {
    const binary = globalThis.atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return { text: new TextDecoder().decode(bytes), decoded: true };
  } catch {
    return { text: null, decoded: false };
  }
}

export function outputEntryView(entry) {
  const streamRaw = typeof entry?.stream?.raw === "string"
    ? entry.stream.raw
    : nestedString(entry?.stream, ["stream", "kind"]);
  const directText = typeof entry?.text === "string" ? entry.text : null;
  const decoded = directText == null
    ? decodeBase64Text(entry?.chunk_b64)
    : { text: directText, decoded: true };
  return {
    shellId: nonEmptyStringOrNull(entry?.id ?? entry?.shell_id ?? entry?.shellId),
    stream: categoryView(streamRaw, KNOWN_STREAMS),
    text: decoded.text,
    decoded: decoded.decoded,
  };
}

/* An output buffer is explicitly a bounded view from this connection's
   subscription boundary. There is no cursor, recovery promise, or complete-
   history claim because output that arrived before that boundary is gone. */
export function outputBufferView(entries = [], { bufferDiscarded = false } = {}) {
  return {
    delivery: "connection_transient",
    replayable: false,
    complete: false,
    startsAt: "subscription_start",
    priorOutputCaptured: false,
    bufferDiscarded: bufferDiscarded === true,
    notice: SHELL_OUTPUT_TRANSIENT_NOTICE,
    entries: Array.isArray(entries) ? entries.map(outputEntryView) : [],
  };
}

export function shellUnavailableFromError(error) {
  return error?.code === "missing_feature" || lifecycleUnavailableFromError(error);
}

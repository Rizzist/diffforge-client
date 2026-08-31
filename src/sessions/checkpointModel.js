import { lifecycleUnavailableFromError } from "./lifecycleModel.js";

/* Pure checkpoint views. Durable workspace state belongs to the daemon: this
   module validates coordinates and labels published facts, but never invents
   a branch, revision, cursor, path, or mutation result. */

const DECIMAL_STRING = /^\d+$/;

const KNOWN_CHECKPOINT_KINDS = new Set([
  "create",
  "delete",
  "edit",
  "move",
  "rename",
  "rollback_turn",
  "undo",
  "redo",
  "workspace_edit",
  "workspace_write",
]);

const KNOWN_CHECKPOINT_ORIGINS = new Set([
  "agent",
  "operator",
  "redo",
  "rollback_turn",
  "system",
  "tool",
  "tool_call",
  "undo",
  "user",
]);

function stringOrNull(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/* A boundary-coerced number is refused even when it looks integral: above
   2^53 it may already name a different position. Decimal strings remain
   byte-for-byte as published and are converted only inside comparisons. */
export function decimalStringOrNull(value) {
  return typeof value === "string" && DECIMAL_STRING.test(value) ? value : null;
}

export function compareDecimalStrings(left, right) {
  const leftValue = decimalStringOrNull(left);
  const rightValue = decimalStringOrNull(right);
  if (leftValue == null || rightValue == null) return null;
  const leftBig = BigInt(leftValue);
  const rightBig = BigInt(rightValue);
  if (leftBig < rightBig) return -1;
  if (leftBig > rightBig) return 1;
  return 0;
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

function publishedTouchedPaths(record) {
  const paths = [];
  const add = (value) => {
    if (typeof value === "string" && value.length > 0 && !paths.includes(value)) {
      paths.push(value);
    }
  };
  add(record?.path);
  for (const value of Array.isArray(record?.touched_paths) ? record.touched_paths : []) add(value);
  for (const value of Array.isArray(record?.paths) ? record.paths : []) add(value);
  for (const change of Array.isArray(record?.changes) ? record.changes : []) add(change?.path);
  for (const effect of Array.isArray(record?.effects) ? record.effects : []) add(effect?.path);
  return paths;
}

/* One timeline record. branch_id and workspace_revision are explicitly
   nullable view facts; seq/revision accept decimal strings only. Unknown
   kind/origin strings survive verbatim with recognized:false. */
export function checkpointView(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  return {
    checkpointId: stringOrNull(record.checkpoint_id),
    sessionId: stringOrNull(record.session_id),
    branchId: stringOrNull(record.branch_id),
    runId: stringOrNull(record.run_id),
    effectId: stringOrNull(record.effect_id),
    callId: stringOrNull(record.call_id),
    seq: decimalStringOrNull(record.seq),
    workspaceRevision: decimalStringOrNull(record.workspace_revision),
    kind: categoryView(record.kind, KNOWN_CHECKPOINT_KINDS),
    origin: categoryView(record.origin, KNOWN_CHECKPOINT_ORIGINS),
    touchedPaths: publishedTouchedPaths(record),
    raw: record,
  };
}

/* Array#sort comparator for newest-first rendering. Valid seqs outrank an
   invalid/absent seq, and u64-scale ordering is exact through BigInt. */
export function newestCheckpointFirst(left, right) {
  const leftSeq = left?.seq;
  const rightSeq = right?.seq;
  if (leftSeq == null && rightSeq == null) return 0;
  if (leftSeq == null) return 1;
  if (rightSeq == null) return -1;
  const order = compareDecimalStrings(leftSeq, rightSeq);
  return order == null ? 0 : -order;
}

export function sortCheckpointsNewestFirst(checkpoints) {
  return [...(Array.isArray(checkpoints) ? checkpoints : [])]
    .sort(newestCheckpointFirst);
}

/* Pagination carries two independent facts: whether this page contains
   checkpoints, and whether the daemon explicitly published null as END OF
   LIST. An absent/malformed next_cursor is invalid, not a fabricated end. */
export function listPageView(page) {
  const rawCheckpoints = Array.isArray(page?.checkpoints) ? page.checkpoints : [];
  const checkpoints = sortCheckpointsNewestFirst(
    rawCheckpoints.map(checkpointView).filter(Boolean),
  );
  const rawCursor = page?.next_cursor;
  const nextCursor = decimalStringOrNull(rawCursor);
  const endOfList = rawCursor === null;
  return {
    checkpoints,
    nextCursor,
    endOfList,
    empty: checkpoints.length === 0,
    cursorState: endOfList ? "end" : nextCursor == null ? "invalid" : "more",
  };
}

function errorObjects(error) {
  const found = [];
  const visit = (value, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 4 || found.includes(value)) return;
    found.push(value);
    for (const key of ["conflict", "error", "outcome", "details", "data", "cause"]) {
      visit(value[key], depth + 1);
    }
  };
  visit(error);
  return found;
}

function conflictTag(value) {
  if (value === true) return true;
  return typeof value === "string" && /(?:^|[_ .-])conflict(?:$|[_ .-])/i.test(value);
}

/* A typed conflict can be thrown or returned as an outcome. Only published
   fields are carried. Missing path/digests remain null so the panel can say
   "not published" instead of manufacturing either side of the fence. */
export function conflictView(error) {
  const objects = errorObjects(error);
  const typed = objects.some((value) => (
    conflictTag(value.conflict)
      || conflictTag(value.code)
      || conflictTag(value.kind)
      || conflictTag(value.status)
      || conflictTag(value.type)
  ));
  const facts = objects.find((value) => (
    Object.prototype.hasOwnProperty.call(value, "path")
      || Object.prototype.hasOwnProperty.call(value, "expected_digest")
      || Object.prototype.hasOwnProperty.call(value, "current_digest")
  ));
  if (!typed && !facts) return null;
  const source = facts || objects[0] || {};
  return {
    kind: "conflict",
    path: stringOrNull(source.path),
    expectedDigest: stringOrNull(source.expected_digest),
    currentDigest: stringOrNull(source.current_digest),
  };
}

/* The receipt is post-mutation authority. The restored id array is retained
   verbatim (same array, same order and values); it is never inferred from
   the target or the checkpoint. */
export function mutationReceiptView(receipt) {
  return {
    checkpoint: checkpointView(receipt?.checkpoint),
    restoredCheckpointIds: Array.isArray(receipt?.restored_checkpoint_ids)
      ? receipt.restored_checkpoint_ids
      : null,
    workerGeneration: receipt
      && Object.prototype.hasOwnProperty.call(receipt, "worker_generation")
      ? receipt.worker_generation
      : null,
  };
}

/* Checkpoints share the lifecycle/Loom feature-gate vocabulary so String
   throws settle unavailable just like the neighboring session surfaces. */
export function checkpointUnavailableFromError(error) {
  return lifecycleUnavailableFromError(error);
}

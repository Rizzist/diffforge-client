import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(HERE, "..");
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

function frontendSources(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...frontendSources(path));
    if (entry.isFile()
      && /\.(?:js|jsx|mjs)$/.test(entry.name)
      && !/\.test\.(?:js|mjs)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

test("[pin] the four checkpoint commands use the pinned snake_case SDK keys", () => {
  const hook = read("./useCheckpoints.js");

  const listAt = hook.indexOf('invoke("checkpoint_list", payload)');
  assert.notEqual(listAt, -1, "checkpoint_list must invoke its explicit payload");
  const listBlock = hook.slice(hook.lastIndexOf("const payload = {", listAt), listAt);
  for (const key of [
    "session_id: sessionId",
    "...branchArgs(branchId)",
    "{ cursor: position }",
    "limit: PAGE_LIMIT",
  ]) {
    assert.ok(listBlock.includes(key), `checkpoint_list payload must carry ${key}`);
  }

  const commandKeys = {
    checkpoint_undo: ["session_id: sessionId", "...branchArgs(branchId)", "target,"],
    checkpoint_redo: ["session_id: sessionId", "...branchArgs(branchId)", "target,"],
    checkpoint_rollback_turn: ["session_id: sessionId", "...branchArgs(branchId)", "run_id: runId"],
  };
  for (const [command, keys] of Object.entries(commandKeys)) {
    const start = hook.indexOf(`invoke("${command}", {`);
    assert.notEqual(start, -1, `${command} must be invoked`);
    const block = hook.slice(start, hook.indexOf("}),", start));
    for (const key of keys) {
      assert.ok(block.includes(key), `${command} must carry ${key}`);
    }
    if (command !== "checkpoint_rollback_turn") {
      assert.match(block, /^\s*target,\s*$/m,
        `${command} must publish target under the exact target key`);
      assert.doesNotMatch(block, /target_id\s*:/,
        `${command} must not rename the pinned target key`);
    }
    assert.doesNotMatch(block, /\b(?:sessionId|branchId|runId)\s*:/,
      `${command} must not publish camelCase wire keys`);
  }

  assert.match(hook, /return typeof branchId === "string" && branchId\.length > 0\s*\? \{ branch_id: branchId \}\s*: \{\};/,
    "branch_id must be omitted, not defaulted, when absent");
});

test("[pin] every checkpoint invoke is centralized in useCheckpoints and the panel is presentational", () => {
  const commands = [
    "checkpoint_list",
    "checkpoint_undo",
    "checkpoint_redo",
    "checkpoint_rollback_turn",
  ];
  const hook = read("./useCheckpoints.js");
  const sources = frontendSources(SRC_ROOT);

  for (const command of commands) {
    assert.equal((hook.match(new RegExp(`invoke\\("${command}"`, "g")) || []).length, 1,
      `useCheckpoints must own exactly one ${command} dispatch`);
    const owners = sources
      .filter((path) => readFileSync(path, "utf8").includes(`invoke("${command}"`))
      .map((path) => relative(SRC_ROOT, path));
    assert.deepEqual(owners, ["sessions/useCheckpoints.js"],
      `${command} must be invoked only from useCheckpoints.js`);
  }
  assert.doesNotMatch(read("./CheckpointPanel.jsx"), /invoke\(/,
    "CheckpointPanel must dispatch only through hook callbacks");
});

test("[pin] mutations are receipt-first, conflict-terminal, and then re-list from authority", () => {
  const hook = read("./useCheckpoints.js");
  const start = hook.indexOf("const runMutation = useCallback");
  const end = hook.indexOf("const undo = useCallback", start);
  const mutation = hook.slice(start, end);

  assert.ok(mutation.includes("const receipt = mutationReceiptView(rawReceipt);"),
    "a successful mutation must be shaped from the daemon receipt");
  assert.ok(mutation.indexOf("setReceiptBySession") < mutation.indexOf("await list(sessionId, branchId);"),
    "the receipt must land before the authoritative re-list");
  assert.ok(mutation.includes("await list(sessionId, branchId);"),
    "every accepted mutation must re-list from checkpoint authority");
  assert.doesNotMatch(mutation, /setBySession|commitBySession|mergeCheckpointViews/,
    "mutation code must never optimistically edit the timeline");

  const conflictAt = mutation.indexOf("const conflict = conflictView(rawReceipt);");
  const reListAt = mutation.indexOf("await list(sessionId, branchId);");
  const conflictBlock = mutation.slice(conflictAt, reListAt);
  assert.match(conflictBlock, /if \(conflict\)[\s\S]*return null;/,
    "a returned conflict must stop the gesture without an automatic retry");
  assert.doesNotMatch(conflictBlock, /expectedDigest|currentDigest|dispatch\(\)/,
    "conflict handling must not substitute a digest or dispatch again");

  assert.ok(hook.includes("unavailableRef.current"),
    "feature-gated commands must settle once in a ref fence");
  assert.match(hook, /if \(!enabled \|\| !sessionId \|\| unavailableRef\.current\) return null;/,
    "settled unavailable state must suppress repeat invokes");
});

test("[pin] SessionSurface mounts the per-session checkpoint view and AppShell wires the hook", () => {
  const surface = read("./SessionSurface.jsx");
  const shell = read("../app/AppShell.jsx");

  assert.match(surface, /import CheckpointPanel from "\.\/CheckpointPanel\.jsx"/);
  assert.ok(surface.includes('selectView("checkpoints")'),
    "the per-session view toggle must offer checkpoint history");
  assert.ok(surface.includes('(viewModes[id] || "ui") !== "checkpoints"'),
    "the enter effect must be scoped to checkpoint mode");
  assert.ok(surface.includes("onLoadCheckpoints?.(id, activeCheckpointBranchId)"),
    "entering the view must list from authority with typed branch absence");
  assert.match(surface, /mode === "checkpoints" && session && session\.id !== "draft"/,
    "the panel must mount only for a real session in checkpoint mode");
  assert.ok(surface.includes("entry={checkpointBySession[session.id]}"),
    "an unread list must remain undefined, not collapse into empty");
  assert.doesNotMatch(surface, /checkpointBySession\[session\.id\]\s*(?:\|\||\?\?)/,
    "the surface must not fabricate an empty checkpoint list");
  for (const prop of [
    "onLoadMoreCheckpoints",
    "onUndoCheckpoint",
    "onRedoCheckpoint",
    "onRollbackCheckpointTurn",
  ]) {
    assert.ok(surface.includes(prop), `SessionSurface must wire ${prop}`);
  }

  assert.match(shell, /import \{ useCheckpoints \} from "\.\.\/sessions\/useCheckpoints\.js"/);
  assert.match(shell, /const checkpointApi = useCheckpoints\(\{ enabled: authState === "authenticated" \}\)/,
    "AppShell must own an auth-gated checkpoint hook");
  for (const prop of [
    "checkpointBySession={checkpointApi.bySession}",
    "checkpointConflictBySession={checkpointApi.conflictBySession}",
    "checkpointReceiptBySession={checkpointApi.receiptBySession}",
    "checkpointUnavailable={checkpointApi.unavailable}",
    "onLoadCheckpoints={checkpointApi.list}",
    "onLoadMoreCheckpoints={checkpointApi.loadMore}",
    "onUndoCheckpoint={checkpointApi.undo}",
    "onRedoCheckpoint={checkpointApi.redo}",
    "onRollbackCheckpointTurn={checkpointApi.rollbackTurn}",
  ]) {
    assert.ok(shell.includes(prop), `AppShell must pass ${prop}`);
  }
});

test("[pin] cursor code never numeric-parses and paging advances with the validated string", () => {
  const model = read("./checkpointModel.js");
  const hook = read("./useCheckpoints.js");

  assert.ok(model.includes("const DECIMAL_STRING = /^\\d+$/;"));
  assert.match(model, /typeof value === "string" && DECIMAL_STRING\.test\(value\)/,
    "only decimal strings may become checkpoint positions");
  assert.ok(model.includes("BigInt(leftValue)"));
  assert.ok(model.includes("BigInt(rightValue)"));
  assert.ok(hook.includes("return list(sessionId, branchId, entry.nextCursor, true);"),
    "load-more must pass the model-validated nextCursor verbatim");
  assert.ok(hook.includes("{ cursor: position }"),
    "the string cursor must use the SDK's cursor wire key");
  for (const [name, source] of [["model", model], ["hook", hook]]) {
    assert.doesNotMatch(source, /\b(?:Number|parseInt)\(/,
      `checkpoint ${name} must never numeric-parse a cursor or seq`);
  }
});

test("[pin] panel wording distinguishes empty/end, exposes conflicts, and marks future values", () => {
  const panel = read("./CheckpointPanel.jsx");
  assert.ok(panel.includes("No checkpoints yet."),
    "an honestly empty first page needs its own wording");
  assert.ok(panel.includes("No more checkpoints."),
    "explicit next_cursor:null needs end-of-list wording on a populated timeline");
  assert.ok(panel.includes("Checkpoint conflict — the workspace moved underneath this checkpoint."));
  assert.ok(panel.includes('conflict.path ?? "not published"'));
  assert.ok(panel.includes('conflict.expectedDigest ?? "not published"'));
  assert.ok(panel.includes('conflict.currentDigest ?? "not published"'));
  assert.ok(panel.includes("Re-read / refresh"),
    "a conflict must offer a manual authority refresh");
  assert.ok(panel.includes("(unrecognized {label})"),
    "future kind/origin values must be visibly marked unrecognized");
  assert.ok(panel.includes("Roll back this turn"));
});

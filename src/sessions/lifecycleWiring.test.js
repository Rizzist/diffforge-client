import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("[pin] the four lifecycle commands live once in the hook with exact snake_case keys", () => {
  const hook = read("./useSessionLifecycle.js");
  const blocks = {
    ade_session_rename: hook.slice(
      hook.indexOf('invoke("ade_session_rename"'),
      hook.indexOf('const compact =', hook.indexOf('invoke("ade_session_rename"')),
    ),
    session_compact: hook.slice(
      hook.indexOf('invoke("session_compact"'),
      hook.indexOf('const fork =', hook.indexOf('invoke("session_compact"')),
    ),
    session_fork: hook.slice(
      hook.indexOf('invoke("session_fork"'),
      hook.indexOf('const retry =', hook.indexOf('invoke("session_fork"')),
    ),
    run_retry: hook.slice(hook.indexOf('invoke("run_retry"')),
  };

  for (const localCommand of ["session_rename", "session_create"]) {
    assert.ok(!hook.includes(`invoke("${localCommand}"`),
      `${localCommand} is local-roster-only and must never dispatch from the lifecycle hook`);
  }
  for (const command of Object.keys(blocks)) {
    assert.notEqual(blocks[command].length, 0, `${command} must have an inspectable block`);
    assert.equal((hook.match(new RegExp(`invoke\\("${command}"`, "g")) || []).length, 1,
      `${command} must dispatch exactly once`);
  }
  assert.match(blocks.ade_session_rename, /session_id: sessionId/);
  assert.match(blocks.ade_session_rename, /\.\.\.renameArgs\(title\)/,
    "rename must use the omission-aware pure arg helper");
  assert.doesNotMatch(blocks.ade_session_rename, /title:\s*""/,
    "clear must never send an empty-string title");
  assert.match(blocks.session_compact, /session_id: sessionId/);
  assert.match(blocks.session_compact, /branch_id: branchId/);
  assert.match(blocks.session_fork, /session_id: sessionId/);
  assert.match(blocks.session_fork, /source_branch_id: sourceBranchId/);
  assert.match(blocks.session_fork, /fork_node_id: forkNodeId/);
  assert.match(blocks.run_retry, /session_id: session\.id/);
});

test("[pin] lifecycle invokes are hook-only and the lifecycle view is presentational", () => {
  const hook = read("./useSessionLifecycle.js");
  const consumers = [
    read("./SessionLifecycleMenuItems.jsx"),
    read("./SessionsRail.jsx"),
    read("./SessionSurface.jsx"),
    read("../app/AppShell.jsx"),
  ];
  for (const command of ["ade_session_rename", "session_compact", "session_fork", "run_retry"]) {
    assert.ok(hook.includes(`invoke("${command}"`), `${command} must be owned by the hook`);
    for (const consumer of consumers) {
      assert.ok(!consumer.includes(`invoke("${command}"`),
        `${command} must never dispatch from a consumer`);
    }
  }
  assert.ok(!read("./SessionLifecycleMenuItems.jsx").includes("invoke("),
    "the lifecycle component contains no invoke at all");
});

test("[pin] empty inline rename reaches omission semantics in both UI surfaces", () => {
  const rail = read("./SessionsRail.jsx");
  const surface = read("./SessionSurface.jsx");
  const hook = read("./useSessionLifecycle.js");
  const model = read("./lifecycleModel.js");

  assert.match(rail, /onRenameSession\?\.\(id, title \|\| undefined\)/,
    "rail clear must not be rejected before the hook");
  assert.match(surface, /onRenameSession\?\.\(id, title \|\| undefined\)/,
    "header clear must not be rejected before the hook");
  assert.match(model, /return value \? \{ title: value \} : \{\};/,
    "only non-empty titles may create the title key");
  for (const source of [rail, surface, hook]) {
    assert.doesNotMatch(source, /title:\s*""/,
      "no lifecycle wire path may contain an empty-string title filler");
  }
});

test("[pin] receipts refresh authority; fork navigation uses only the receipt id", () => {
  const hook = read("./useSessionLifecycle.js");
  const controls = read("./SessionLifecycleMenuItems.jsx");
  const rail = read("./SessionsRail.jsx");
  const surface = read("./SessionSurface.jsx");
  const dispatchIndex = hook.indexOf("receipt = await dispatch()");
  const refreshIndex = hook.indexOf("await refreshAuthority?.()", dispatchIndex);

  assert.ok(dispatchIndex !== -1 && refreshIndex > dispatchIndex,
    "an accepted receipt must precede the authoritative refresh");
  for (const forbidden of ["setSessions", "setRoster", "setTitle", "setRunState"]) {
    assert.ok(!hook.includes(forbidden), `hook must not optimistically call ${forbidden}`);
  }
  assert.match(controls, /receipt\?\.sessionId !== undefined/,
    "fork navigation must wait for the receipt's new-session coordinate");
  assert.match(rail, /onSelectSession\?\.\(\{ id: receipt\.sessionId \}\)/);
  assert.match(surface, /onOpenSession\?\.\(\{ id: receipt\.sessionId \}\)/);
  assert.doesNotMatch(controls, /sourceSessionId.*onForked|session\.id.*onForked/,
    "source/client ids must never stand in for the fork receipt's new id");
});

test("[pin] retry and unavailable actions are honestly disabled with reasons and settle once", () => {
  const hook = read("./useSessionLifecycle.js");
  const controls = read("./SessionLifecycleMenuItems.jsx");
  const model = read("./lifecycleModel.js");

  assert.match(controls, /const retry = retryEligibility\(session\)/,
    "the view must use the published-run-state eligibility model");
  assert.match(controls, /!retry\.eligible/,
    "an unproven retry must be disabled");
  assert.ok(controls.includes("Retry unavailable"));
  assert.ok(model.includes("Retry unavailable: run state was not published by the daemon."));
  assert.ok(hook.includes("unavailable on this daemon"));
  assert.match(hook, /unavailableRef\.current\[action\]/,
    "each action must stop dispatching after its feature gate settles unavailable");
  for (const pending of ["Renaming…", "Compacting…", "Forking…", "Retrying…"]) {
    assert.ok(controls.includes(pending), `${pending} must render as pending, not assumed success`);
  }
});

test("[pin] AppShell owns the hook and mounts lifecycle controls in rail and header", () => {
  const shell = read("../app/AppShell.jsx");
  const rail = read("./SessionsRail.jsx");
  const surface = read("./SessionSurface.jsx");

  assert.match(shell, /import \{ useSessionLifecycle \} from "\.\.\/sessions\/useSessionLifecycle\.js"/);
  assert.match(shell, /const lifecycleApi = useSessionLifecycle\(\{/);
  assert.match(shell, /refreshAuthority: refreshSessions/);
  for (const prop of [
    "lifecyclePendingBySession={lifecycleApi.pendingBySession}",
    "lifecycleErrorBySession={lifecycleApi.errorBySession}",
    "lifecycleUnavailableByAction={lifecycleApi.unavailableByAction}",
    "onRenameSession={lifecycleApi.rename}",
    "onCompactSession={lifecycleApi.compact}",
    "onForkSession={lifecycleApi.fork}",
    "onRetrySession={lifecycleApi.retry}",
  ]) {
    assert.equal((shell.match(new RegExp(prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length, 2,
      `AppShell must feed ${prop} to both rail and surface`);
  }
  for (const consumer of [rail, surface]) {
    assert.match(consumer, /import SessionLifecycleMenuItems from "\.\/SessionLifecycleMenuItems\.jsx"/);
    assert.match(consumer, /<SessionLifecycleMenuItems/);
  }
});

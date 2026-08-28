import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("[pin] both descendant commands and both push names live only in the hook", () => {
  const hook = read("./useDescendantStream.js");
  assert.match(hook, /invoke\("session_descendants_attach", \{/);
  for (const key of [
    "session_id: sessionId",
    "cursors,",
    "max_children: maxChildren",
  ]) {
    assert.ok(hook.includes(key), `attach must pass pinned snake_case field ${key}`);
  }
  assert.match(hook,
    /invoke\("session_descendants_detach", \{ attachment_id: attachmentId \}\)/,
    "detach must use the real attachment_id");
  assert.equal((hook.match(/invoke\("session_descendants_attach"/g) || []).length, 1);
  assert.equal((hook.match(/invoke\("session_descendants_detach"/g) || []).length, 1);

  for (const eventName of ["session-descendant-stream", "session-descendant-repair"]) {
    assert.equal((hook.match(new RegExp(`listen\\("${eventName}"`, "g")) || []).length, 1,
      `${eventName} must be listened to exactly once`);
  }

  const implementationFiles = readdirSync(new URL("./", import.meta.url))
    .filter((name) => /\.(?:js|jsx)$/.test(name) && !name.endsWith(".test.js"));
  for (const name of implementationFiles) {
    if (name === "useDescendantStream.js") continue;
    const source = read(`./${name}`);
    for (const wireName of [
      "session_descendants_attach",
      "session_descendants_detach",
      "session-descendant-stream",
      "session-descendant-repair",
    ]) {
      assert.ok(!source.includes(wireName),
        `${wireName} must stay centralized in useDescendantStream.js, not ${name}`);
    }
  }
});

test("[pin] AppShell owns the hook and SessionSurface attaches on Fleet enter/detaches on leave", () => {
  const shell = read("../app/AppShell.jsx");
  const surface = read("./SessionSurface.jsx");
  assert.match(shell,
    /import \{ useDescendantStream \} from "\.\.\/sessions\/useDescendantStream\.js"/);
  assert.match(shell,
    /const descendantApi = useDescendantStream\(\{ enabled: authState === "authenticated" \}\)/);
  for (const prop of [
    "descendantEntry={descendantApi.entry}",
    "descendantMode={descendantApi.mode}",
    "descendantRepair={descendantApi.repair}",
    "descendantSessionId={descendantApi.sessionId}",
    "onReconnectDescendantStream={descendantApi.reconnect}",
    "onStartDescendantStream={descendantApi.start}",
    "onStopDescendantStream={descendantApi.stop}",
  ]) {
    assert.ok(shell.includes(prop), `AppShell must pass ${prop}`);
  }
  assert.match(surface, /\(viewModes\[id\] \|\| "ui"\) !== "fleet"/,
    "the lifecycle must be gated on actually entering Fleet");
  assert.match(surface, /void onStartDescendantStream\?\.\(id\)/,
    "Fleet enter must attach the active real session");
  assert.ok((surface.match(/void onStopDescendantStream\?\.\(\)/g) || []).length >= 2,
    "non-Fleet state and effect cleanup must both detach");
  assert.ok(surface.includes("const liveForSession = descendantMode === \"live\""),
    "only an explicitly live, matching-session entry may replace the snapshot tree");
});

test("[pin] live/snapshot, fan-out, truncation, repair, and unknown facts are worded honestly", () => {
  const panel = read("./FleetPanel.jsx");
  for (const wording of [
    "Live descendant stream",
    "Point-in-time snapshot — live stream unavailable",
    "Fan-out: requested children",
    "accepted children",
    "hard limit",
    "some requested children were not streamed",
    "Truncation: truncated",
    "omitted total unknown (count incomplete, so it is not a trustworthy total)",
    "Repair reattached after a reported gap using this client&apos;s held per-child cursors.",
    "The repair frame made no sequence claim.",
    "Unrecognized live change preserved",
    "unrecognized state:",
  ]) {
    assert.ok(panel.includes(wording), `FleetPanel must render honest wording: ${wording}`);
  }
  assert.match(panel, /streamTruncation\.omittedCountTrusted \? \(/,
    "the omitted number may render as a total only behind the trusted-count branch");
  assert.match(panel, /const isLive = streamMode === "live" && entry != null/,
    "live presentation must require the hook's explicit live mode");
});

test("[pin] repair resumes only from held client cursors and cursor code never numeric-parses", () => {
  const hook = read("./useDescendantStream.js");
  const model = read("./descendantStreamModel.js");
  assert.match(hook, /const held = cursorsFor\(treeRef\.current\)/);
  assert.match(hook, /const plan = repairPlan\(children, held\)/);
  assert.match(hook, /void connect\(active\.sessionId, plan, \{/,
    "repair reattach must use the held-cursor plan, not the repair frame");
  assert.doesNotMatch(hook, /repairPlan\(children, payload/,
    "a repair frame must never provide resume positions");
  for (const [name, source] of [["model", model], ["hook", hook]]) {
    assert.doesNotMatch(source, /\bNumber\s*\(/,
      `${name} must not convert decimal-string cursors with Number()`);
    assert.doesNotMatch(source, /\bparseInt\s*\(/,
      `${name} must not convert decimal-string cursors with parseInt()`);
  }
  assert.ok(model.includes("BigInt(candidate) > BigInt(held)"),
    "cursor ordering must be BigInt-based");
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  appendUniqueMode,
  claudePermissionModeFromText,
  claudePermissionTargetAvailableInCycle,
  codexPermissionPickerOpen,
  codexPermissionPostSelectionState,
  cyclePermissionModeWithBestEffortRestore,
  findCodexPermissionPickerTarget,
  normalizePermissionModeForProvider,
  opencodeAgentModeFromText,
} from "./permissionModeAutomation.js";
import {
  enqueuePaneControlOperation,
  paneControlOperationPending,
} from "./paneControlQueue.js";

test("codex permission modes canonicalize aliases", () => {
  assert.equal(normalizePermissionModeForProvider("codex", "readonly"), "read-only");
  assert.equal(normalizePermissionModeForProvider("codex", "default"), "auto");
  assert.equal(normalizePermissionModeForProvider("codex", "danger-full-access"), "full-access");
});

test("codex permission picker target is found by visible row labels", () => {
  const text = [
    "Permissions",
    "> Read Only",
    "  Auto",
    "  Full Access",
  ].join("\n");
  const match = findCodexPermissionPickerTarget(text, "full-access");

  assert.equal(codexPermissionPickerOpen(text), true);
  assert.equal(match.found, true);
  assert.equal(match.arrowDownCount, 2);
  assert.equal(match.selectedIndex, 0);
  assert.equal(match.targetIndex, 2);
  assert.deepEqual(match.rows, ["> Read Only", "Auto", "Full Access"]);
});

test("codex permission picker navigation starts from highlighted row", () => {
  const text = [
    "Assistant: Read Only",
    "Assistant: Auto",
    "Assistant: Full Access",
    "Permissions",
    "  Read Only",
    "› Auto",
    "  Full Access",
  ].join("\n");
  const match = findCodexPermissionPickerTarget(text, "read-only");

  assert.equal(match.found, true);
  assert.equal(match.selectedIndex, 1);
  assert.equal(match.targetIndex, 0);
  assert.equal(match.arrowDownCount, 2);
  assert.deepEqual(match.rows, ["Read Only", "› Auto", "Full Access"]);
});

test("codex permission picker fails closed without one active highlighted block", () => {
  const noPointer = [
    "Permissions",
    "  Read Only",
    "  Auto",
    "  Full Access",
  ].join("\n");
  const missingHighlight = findCodexPermissionPickerTarget(noPointer, "auto");
  assert.equal(missingHighlight.found, false);
  assert.equal(missingHighlight.selectedIndex, -1);

  const ambiguous = [
    "Permissions",
    "> Read Only",
    "  Auto",
    "  Full Access",
    "Permissions",
    "  Read Only",
    "> Auto",
    "  Full Access",
  ].join("\n");
  const ambiguousMatch = findCodexPermissionPickerTarget(ambiguous, "full-access");
  assert.equal(ambiguousMatch.found, false);
  assert.equal(ambiguousMatch.ambiguous, true);
});

test("codex permission picker parses current numbered profiles with wrapped descriptions", () => {
  const text = [
    "Update Model Permissions",
    "> 1. Default      Codex can read and edit files in the current workspace, and",
    "                  run commands. Approval is required for broader access.",
    "  2. Auto-review  Same workspace-write permissions as Default, but eligible",
    "                  approvals are routed through the auto-reviewer subagent.",
    "  3. Full Access  Codex can edit outside this workspace and access the internet.",
    "Press enter to confirm or esc to cancel",
  ].join("\n");
  const auto = findCodexPermissionPickerTarget(text, "auto");
  const fullAccess = findCodexPermissionPickerTarget(text, "full-access");
  const readOnly = findCodexPermissionPickerTarget(text, "read-only");

  assert.equal(codexPermissionPickerOpen(text), true);
  assert.equal(auto.found, true);
  assert.equal(auto.targetIndex, 1);
  assert.equal(auto.arrowDownCount, 1);
  assert.equal(fullAccess.found, true);
  assert.equal(fullAccess.targetIndex, 2);
  assert.equal(readOnly.found, false);
});

test("codex permission picker fails closed for duplicate numbered profile semantics", () => {
  const text = [
    "Update Model Permissions",
    "> 1. Default",
    "  2. Auto-review",
    "  3. Auto-review",
    "  4. Full Access",
  ].join("\n");
  const match = findCodexPermissionPickerTarget(text, "auto");

  assert.equal(match.found, false);
  assert.equal(codexPermissionPickerOpen(text), false);
});

test("codex permission picker fails closed for mixed legacy and current profiles", () => {
  const text = [
    "Update Model Permissions",
    "> 1. Default",
    "  2. Auto-review",
    "  3. Auto",
    "  4. Full Access",
  ].join("\n");
  const match = findCodexPermissionPickerTarget(text, "auto");

  assert.equal(match.found, false);
  assert.equal(codexPermissionPickerOpen(text), false);
});

test("codex permission post selection requires matching status evidence", () => {
  const fullAccess = codexPermissionPostSelectionState(
    "Status\nApproval policy: never\nSandbox: danger-full-access",
    "full-access",
  );
  assert.equal(fullAccess.matched, true);
  assert.equal(fullAccess.mode, "full-access");

  const noEvidence = codexPermissionPostSelectionState("Prompt ready", "read-only");
  assert.equal(noEvidence.matched, false);
  assert.equal(noEvidence.mode, "");
});

test("claude permission modes canonicalize and parse status text", () => {
  assert.equal(normalizePermissionModeForProvider("claude", "manual"), "default");
  assert.equal(normalizePermissionModeForProvider("claude", "dont_ask"), "dontAsk");
  assert.equal(normalizePermissionModeForProvider("claude", "bypass-permissions"), "bypassPermissions");
  assert.equal(claudePermissionModeFromText("status: accept edits on"), "acceptEdits");
  assert.equal(claudePermissionModeFromText("footer: don't ask on"), "dontAsk");
});

test("claude parser ignores stale body text outside status rows", () => {
  const text = [
    "Assistant: switch to plan mode on when ready",
    "more old transcript text",
    "ordinary prompt output",
    "input ready",
  ].join("\n");
  assert.equal(claudePermissionModeFromText(text), "");
  assert.equal(claudePermissionModeFromText("Assistant: plan mode on"), "");
});

test("claude unavailable permission modes require restart guidance", () => {
  assert.equal(claudePermissionTargetAvailableInCycle("dontAsk", ["default", "acceptEdits", "plan"]), false);
  assert.equal(claudePermissionTargetAvailableInCycle("bypassPermissions", ["default", "acceptEdits", "plan"]), false);
  assert.equal(claudePermissionTargetAvailableInCycle("bypassPermissions", ["default", "bypassPermissions"]), true);
});

test("opencode agent mode parsing accepts custom lowercase tokens", () => {
  assert.equal(normalizePermissionModeForProvider("opencode", "Review_Bot"), "review_bot");
  assert.equal(opencodeAgentModeFromText("agent: Build  tab agents"), "build");
  assert.equal(opencodeAgentModeFromText("mode = plan  footer"), "plan");
  assert.equal(opencodeAgentModeFromText("Build  ready  tab agents"), "build");
  assert.equal(opencodeAgentModeFromText("Plan  auto  tab agents"), "plan");
  assert.equal(opencodeAgentModeFromText("agent: stale\nBuild  ready  tab agents"), "build");
  assert.equal(opencodeAgentModeFromText("status footer agent: plan tab"), "plan");
  assert.equal(opencodeAgentModeFromText("Assistant mentioned build and plan\nready"), "");
  assert.equal(opencodeAgentModeFromText("Assistant: use agent build next"), "");
  assert.equal(opencodeAgentModeFromText("agent: build"), "");
  assert.equal(opencodeAgentModeFromText("ordinary output\nUse agent: build when ready"), "");
  assert.equal(opencodeAgentModeFromText("old transcript\nagent: build\nprompt ready"), "");
});

test("appendUniqueMode preserves first-seen order", () => {
  assert.deepEqual(appendUniqueMode(["build"], "plan"), ["build", "plan"]);
  assert.deepEqual(appendUniqueMode(["build"], "build"), ["build"]);
});

test("failed Claude and OpenCode cycles restore the original mode", async () => {
  for (const fixture of [
    { provider: "claude", originalMode: "default", sequence: ["acceptEdits", "plan", "default"] },
    { provider: "opencode", originalMode: "build", sequence: ["plan", "review", "build"] },
  ]) {
    const calls = [];
    const result = await cyclePermissionModeWithBestEffortRestore({
      originalMode: fixture.originalMode,
      target_mode: "unreachable",
      maxCycleSteps: 8,
      cycleMode: async () => {
        const mode = fixture.sequence[calls.length % fixture.sequence.length];
        calls.push(mode);
        return mode;
      },
    });

    assert.equal(result.applied, false, fixture.provider);
    assert.equal(result.restored, true, fixture.provider);
    assert.equal(result.currentMode, fixture.originalMode, fixture.provider);
    assert.deepEqual(result.seenModes, [fixture.originalMode, ...fixture.sequence.slice(0, -1)], fixture.provider);
    assert.equal(calls.at(-1), fixture.originalMode, fixture.provider);
  }
});

test("permission cycle restores after a mid-cycle write failure", async () => {
  const sequence = ["plan", new Error("write failed"), "default"];
  const result = await cyclePermissionModeWithBestEffortRestore({
    originalMode: "default",
    target_mode: "bypassPermissions",
    cycleMode: async () => {
      const next = sequence.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  });

  assert.equal(result.applied, false);
  assert.match(result.cycleError.message, /write failed/);
  assert.equal(result.restored, true);
  assert.equal(result.currentMode, "default");
  assert.deepEqual(result.seenModes, ["default", "plan"]);
});

test("permission cycle probes restoration when the first write rejects", async () => {
  const sequence = [new Error("write acknowledgement lost"), "acceptEdits", "plan", "default"];
  const result = await cyclePermissionModeWithBestEffortRestore({
    originalMode: "default",
    target_mode: "bypassPermissions",
    cycleMode: async () => {
      const next = sequence.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  });

  assert.equal(result.restored, true);
  assert.equal(result.currentMode, "default");
  assert.deepEqual(result.seenModes, ["default", "acceptEdits", "plan"]);
});

test("pane control queue serializes full operations and survives rejection", async () => {
  const queue = new Map();
  const events = [];
  let releaseFirst;
  const firstBarrier = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const first = enqueuePaneControlOperation(queue, "pane-1", async () => {
    events.push("first:start");
    await firstBarrier;
    events.push("first:end");
    throw new Error("expected");
  });
  const second = enqueuePaneControlOperation(queue, "pane-1", async () => {
    events.push("second:start");
    await Promise.resolve();
    events.push("second:end");
    return "done";
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(events, ["first:start"]);
  assert.equal(paneControlOperationPending(queue, "pane-1"), true);
  releaseFirst();
  await assert.rejects(first, /expected/);
  assert.equal(await second, "done");
  assert.deepEqual(events, ["first:start", "first:end", "second:start", "second:end"]);
  assert.equal(queue.size, 0);
  assert.equal(paneControlOperationPending(queue, "pane-1"), false);
});

test("pane control queue permits different panes concurrently", async () => {
  const queue = new Map();
  const events = [];
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  const first = enqueuePaneControlOperation(queue, "pane-a", async () => {
    events.push("a");
    await barrier;
  });
  const second = enqueuePaneControlOperation(queue, "pane-b", async () => {
    events.push("b");
  });
  await second;
  assert.deepEqual(events, ["a", "b"]);
  release();
  await first;
});

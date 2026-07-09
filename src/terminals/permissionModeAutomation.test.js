import assert from "node:assert/strict";
import test from "node:test";

import {
  appendUniqueMode,
  claudePermissionModeFromText,
  claudePermissionTargetAvailableInCycle,
  codexPermissionPickerOpen,
  codexPermissionPostSelectionState,
  findCodexPermissionPickerTarget,
  normalizePermissionModeForProvider,
  opencodeAgentModeFromText,
} from "./permissionModeAutomation.js";

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

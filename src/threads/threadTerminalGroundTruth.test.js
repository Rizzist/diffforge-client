import assert from "node:assert/strict";
import test from "node:test";

import {
  getThreadTerminalGroundTruth,
  terminalOutputLooksActive,
  terminalOutputLooksPromptReady,
} from "./threadTerminalGroundTruth.js";

test("terminal output active classifier detects agent work without prompt-ready text", () => {
  assert.equal(terminalOutputLooksActive("• Ran pwd\n/Users/test/project"), true);
  assert.equal(terminalOutputLooksActive("I’ll inspect the repo and then summarize it."), true);
  assert.equal(terminalOutputLooksActive("\n› "), false);
  assert.equal(terminalOutputLooksPromptReady("\n› "), true);
});

test("active terminal output keeps a stale completed turn working", () => {
  const groundTruth = getThreadTerminalGroundTruth({
    liveTerminal: {
      inputReady: false,
      status: "active",
    },
    providerBinding: {
      inputReady: false,
      status: "active",
    },
    targetRole: "codex",
    thread: {
      activityStatus: "thinking",
      latestTurn: {
        state: "completed",
      },
      messageCount: 1,
      messages: [{ role: "user", text: "summarize the repo" }],
      projectionEvents: [{ type: "thread.message.user" }],
    },
  });

  assert.equal(groundTruth.completedTurnLooksStaleActive, true);
  assert.equal(groundTruth.effectiveActivityStatus, "thinking");
  assert.equal(groundTruth.effectiveLatestTurnState, "running");
  assert.equal(groundTruth.terminalWorkState, "running");
  assert.equal(groundTruth.terminalIsComplete, false);
  assert.equal(groundTruth.agentInputReady, false);
});

test("fresh prompt readiness still completes a completed turn", () => {
  const groundTruth = getThreadTerminalGroundTruth({
    liveTerminal: {
      inputReady: true,
      inputReadyAt: "2026-05-30T10:01:00.000Z",
      status: "active",
    },
    providerBinding: {
      inputReady: true,
      inputReadyAt: "2026-05-30T10:01:00.000Z",
      status: "active",
    },
    targetRole: "codex",
    thread: {
      activityStatus: "thinking",
      latestTurn: {
        startedAt: "2026-05-30T10:00:00.000Z",
        state: "completed",
      },
      messageCount: 1,
      messages: [{ role: "user", text: "summarize the repo" }],
      projectionEvents: [{ type: "thread.message.user" }],
    },
  });

  assert.equal(groundTruth.completedTurnLooksStaleActive, false);
  assert.equal(groundTruth.effectiveActivityStatus, "idle");
  assert.equal(groundTruth.effectiveLatestTurnState, "completed");
  assert.equal(groundTruth.terminalWorkState, "complete");
  assert.equal(groundTruth.terminalIsComplete, true);
});

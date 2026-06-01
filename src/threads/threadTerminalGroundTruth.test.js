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

test("terminal output prompt-ready classifier handles Codex ANSI redraws", () => {
  const finishedCodexScreen = "\u001b[39;49m\u001b[K\u001b[2m•  \u001b[22mThe project is basically empty.\u001b[39m\u001b[49m\u001b[0m"
    + "\u001b[r\u001b[47;3H\u001b[45;2H\u001b[0m\u001b[49m\u001b[K"
    + "\u001b[47;1H\u001b[1m›\u001b[47;3H\u001b[22m\u001b[2mExplain this codebase"
    + "\u001b[49;3H\u001b[22m\u001b[38;2;246;226;183;49mgpt-5.5 xhigh\u001b[2m\u001b[39;49m · "
    + "\u001b[22m\u001b[38;2;171;223;167;49m~/Documents/CODING/testforge\u001b[39m\u001b[49m";

  assert.equal(terminalOutputLooksPromptReady(finishedCodexScreen), true);
  assert.equal(terminalOutputLooksActive(finishedCodexScreen), false);
});

test("terminal output keeps Codex working screen active even when the prompt line is visible", () => {
  const workingCodexScreen = "\u001b[44;3H\u001b[2mWorking\u001b[22m \u001b[2m(10s • esc to interrupt)\u001b[39m"
    + "\u001b[47;1H\u001b[22m\u001b[1m›\u001b[47;3H\u001b[22m\u001b[2mExplain this codebase";

  assert.equal(terminalOutputLooksPromptReady(workingCodexScreen), false);
  assert.equal(terminalOutputLooksActive(workingCodexScreen), true);
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

test("idle terminal activity is sendable when prompt readiness is fresh", () => {
  const groundTruth = getThreadTerminalGroundTruth({
    liveTerminal: {
      activityStatus: "idle",
      inputReady: true,
      inputReadyAt: "2026-05-30T10:01:00.000Z",
      status: "idle",
    },
    providerBinding: {
      activityStatus: "idle",
      inputReady: true,
      inputReadyAt: "2026-05-30T10:01:00.000Z",
      status: "idle",
    },
    targetRole: "codex",
    thread: {
      activityStatus: "thinking",
      latestTurn: {
        startedAt: "2026-05-30T10:00:00.000Z",
        state: "completed",
      },
      messageCount: 2,
      messages: [
        { role: "user", text: "summarize the repo" },
        { role: "assistant", text: "Done." },
      ],
      projectionEvents: [
        { type: "thread.message.user" },
        { type: "thread.message.assistant.complete" },
      ],
    },
  });

  assert.equal(groundTruth.terminalLooksSendable, true);
  assert.equal(groundTruth.completedTurnLooksSendable, true);
  assert.equal(groundTruth.effectiveActivityStatus, "idle");
  assert.equal(groundTruth.terminalWorkState, "complete");
});

test("live idle activity is sendable even when explicit inputReady was not persisted", () => {
  const groundTruth = getThreadTerminalGroundTruth({
    liveTerminal: {
      activityStatus: "idle",
      inputReady: false,
      status: "idle",
    },
    providerBinding: {
      activityStatus: "idle",
      inputReady: false,
      status: "idle",
    },
    targetRole: "codex",
    thread: {
      activityStatus: "idle",
      latestTurn: {
        state: "completed",
      },
      messageCount: 2,
      messages: [
        { role: "user", text: "summarize the repo" },
        { role: "assistant", text: "Done." },
      ],
      projectionEvents: [
        { type: "thread.message.user" },
        { type: "thread.message.assistant.complete" },
      ],
    },
  });

  assert.equal(groundTruth.activityStatusLooksInputReady, true);
  assert.equal(groundTruth.completedTurnLooksSendable, true);
  assert.equal(groundTruth.agentInputReady, true);
});

test("fresh prompt readiness settles a restored running turn", () => {
  const groundTruth = getThreadTerminalGroundTruth({
    liveTerminal: {
      activityStatus: "idle",
      inputReady: true,
      inputReadyAt: "2026-05-30T10:15:00.000Z",
      status: "active",
    },
    providerBinding: {
      activityStatus: "idle",
      inputReady: true,
      inputReadyAt: "2026-05-30T10:15:00.000Z",
      status: "active",
    },
    targetRole: "codex",
    thread: {
      activityStatus: "thinking",
      latestTurn: {
        startedAt: "2026-05-30T10:00:00.000Z",
        state: "running",
      },
      messageCount: 2,
      messages: [
        { role: "user", text: "make a pricing.html" },
        { role: "assistant", text: "I'll add it now." },
      ],
      projectionEvents: [
        { type: "thread.message.user" },
        { type: "thread.message.assistant.delta" },
      ],
    },
  });

  assert.equal(groundTruth.runningTurnLooksIdle, true);
  assert.equal(groundTruth.effectiveActivityStatus, "idle");
  assert.equal(groundTruth.effectiveLatestTurnState, "completed");
  assert.equal(groundTruth.terminalGroundTruthStatus, "idle_or_prompt_ready");
});

test("pending session acceptance keeps a running turn active despite prompt readiness", () => {
  const groundTruth = getThreadTerminalGroundTruth({
    liveTerminal: {
      inputReady: true,
      inputReadyAt: "2026-05-30T10:15:00.000Z",
      status: "active",
    },
    providerBinding: {
      inputReady: true,
      inputReadyAt: "2026-05-30T10:15:00.000Z",
      status: "active",
    },
    targetRole: "codex",
    thread: {
      activityStatus: "thinking",
      latestTurn: {
        startedAt: "2026-05-30T10:00:00.000Z",
        state: "running",
      },
      messageCount: 0,
      messages: [],
      pendingPrompt: {
        id: "prompt-test",
        text: "summarize recent commits",
      },
      projectionEvents: [{ type: "thread.turn.started" }],
    },
  });

  assert.equal(groundTruth.promptSubmissionPending, true);
  assert.equal(groundTruth.runningTurnLooksIdle, false);
  assert.equal(groundTruth.agentInputReady, false);
  assert.equal(groundTruth.terminalGroundTruthStatus, "processing_or_active");
  assert.equal(groundTruth.terminalWorkState, "running");
});

test("completed transcript without fresh readiness is not sendable", () => {
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
      activityStatus: "idle",
      latestTurn: {
        startedAt: "2026-05-30T10:00:00.000Z",
        state: "completed",
      },
      messageCount: 2,
      messages: [
        { role: "user", text: "make a pricing.html" },
        { role: "assistant", text: "I am still working on it." },
      ],
      projectionEvents: [
        { type: "thread.message.user" },
        { type: "thread.message.assistant.complete" },
      ],
    },
  });

  assert.equal(groundTruth.effectiveActivityStatus, "idle");
  assert.equal(groundTruth.effectiveLatestTurnState, "completed");
  assert.equal(groundTruth.completedTurnLooksSendable, false);
  assert.equal(groundTruth.agentInputReady, false);
});

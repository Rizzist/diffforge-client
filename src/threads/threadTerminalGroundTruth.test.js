import assert from "node:assert/strict";
import test from "node:test";

import {
  getThreadTerminalGroundTruth,
  terminalPromptingUserBlocksShutdown,
} from "./threadTerminalGroundTruth.js";

test("null terminal prompt sources are treated as idle", () => {
  const groundTruth = getThreadTerminalGroundTruth({
    liveTerminal: null,
    providerBinding: null,
    targetRole: "codex",
    thread: {
      activityStatus: "idle",
      latestTurn: {
        state: "completed",
      },
      messageCount: 0,
      messages: [],
      projectionEvents: [],
    },
  });

  assert.equal(groundTruth.terminalIsPromptingUser, false);
  assert.equal(terminalPromptingUserBlocksShutdown(groundTruth), false);
});

test("active lifecycle status keeps a stale completed turn working", () => {
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

test("fresh lifecycle input-ready still completes a completed turn", () => {
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

test("idle terminal activity is sendable when lifecycle input-ready is fresh", () => {
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

test("idle assistant follow-up questions do not block shutdown", () => {
  const groundTruth = getThreadTerminalGroundTruth({
    liveTerminal: {
      activityStatus: "idle",
      inputReady: true,
      status: "idle",
    },
    providerBinding: {
      activityStatus: "idle",
      inputReady: true,
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
        { role: "user", text: "hi" },
        { role: "assistant", text: "Hi. What would you like me to work on next?" },
      ],
      projectionEvents: [
        { type: "thread.message.user" },
        { type: "thread.message.assistant.complete" },
      ],
    },
  });

  assert.equal(groundTruth.terminalIsPromptingUser, false);
  assert.equal(groundTruth.promptingUserSource, "");
  assert.equal(terminalPromptingUserBlocksShutdown(groundTruth), false);
});

test("live terminal permission prompts still block shutdown", () => {
  const groundTruth = getThreadTerminalGroundTruth({
    lifecycleEvent: {
      promptingUserKind: "permission",
      promptingUserSource: "provider-permission",
      promptingUserText: "Allow command to run?",
      terminalIsPromptingUser: true,
      toolUseId: "tool-1",
      type: "terminal-output",
    },
    liveTerminal: {
      activityStatus: "idle",
      inputReady: true,
      status: "idle",
    },
    providerBinding: {
      activityStatus: "idle",
      inputReady: true,
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
        { role: "user", text: "run the risky command" },
        { role: "assistant", text: "I need permission." },
      ],
      projectionEvents: [
        { type: "thread.message.user" },
        { type: "thread.message.assistant.complete" },
      ],
    },
  });

  assert.equal(groundTruth.terminalIsPromptingUser, true);
  assert.equal(groundTruth.promptingUserSource, "provider-permission");
  assert.equal(terminalPromptingUserBlocksShutdown(groundTruth), true);
});

test("terminal output permission-looking text does not create needs-input state", () => {
  const groundTruth = getThreadTerminalGroundTruth({
    lifecycleEvent: {
      promptingUserKind: "permission",
      promptingUserSource: "terminal-output",
      promptingUserText: "Allow command to run?",
      terminalIsPromptingUser: true,
      type: "terminal-output",
    },
    liveTerminal: {
      activityStatus: "idle",
      inputReady: true,
      status: "idle",
    },
    providerBinding: {
      activityStatus: "idle",
      inputReady: true,
      status: "idle",
    },
    targetRole: "codex",
    thread: {
      activityStatus: "idle",
      latestTurn: {
        state: "completed",
      },
      messageCount: 0,
      messages: [],
      projectionEvents: [],
    },
  });

  assert.equal(groundTruth.terminalIsPromptingUser, false);
  assert.equal(groundTruth.promptingUserKind, "");
  assert.equal(terminalPromptingUserBlocksShutdown(groundTruth), false);
});

test("provider lifecycle clears stale terminal prompt signals", () => {
  const groundTruth = getThreadTerminalGroundTruth({
    lifecycleEvent: {
      outputText: "Allow command to run?",
      source: "cli-hook:provider-turn-completed",
      type: "provider-turn-completed",
    },
    liveTerminal: {
      activityStatus: "idle",
      inputReady: true,
      promptingUserKind: "permission",
      promptingUserSource: "terminal-output",
      promptingUserText: "Allow command to run?",
      status: "idle",
      terminalIsPromptingUser: true,
    },
    providerBinding: {
      activityStatus: "idle",
      inputReady: true,
      promptingUserKind: "permission",
      promptingUserSource: "terminal-output",
      promptingUserText: "Allow command to run?",
      status: "idle",
      terminalIsPromptingUser: true,
    },
    targetRole: "codex",
    thread: {
      activityStatus: "idle",
      latestTurn: {
        state: "completed",
      },
      messageCount: 0,
      messages: [],
      projectionEvents: [],
    },
  });

  assert.equal(groundTruth.terminalIsPromptingUser, false);
  assert.equal(terminalPromptingUserBlocksShutdown(groundTruth), false);
  assert.equal(groundTruth.terminalWorkState, "complete");
});

test("fresh lifecycle input-ready settles a restored running turn", () => {
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
  assert.equal(groundTruth.terminalGroundTruthStatus, "idle_or_input_ready");
  assert.equal(groundTruth.terminalWorkState, "complete");
  assert.equal(groundTruth.terminalIsComplete, true);
});

test("idle hook-managed runtime settles a restored running turn without input-ready", () => {
  const groundTruth = getThreadTerminalGroundTruth({
    liveTerminal: {
      activityStatus: "idle",
      agentId: "codex",
      inputReady: false,
      status: "active",
    },
    providerBinding: {
      activityStatus: "idle",
      inputReady: false,
      nativeSessionId: "codex-session-1",
      status: "active",
    },
    targetRole: "codex",
    thread: {
      activityStatus: "idle",
      latestTurn: {
        startedAt: "2026-05-30T10:00:00.000Z",
        state: "running",
      },
      messageCount: 2,
      messages: [
        { role: "user", text: "audit the project" },
        { role: "assistant", text: "Done." },
      ],
      projectionEvents: [
        { type: "thread.message.user" },
        { type: "thread.message.assistant.complete" },
      ],
      providerBindings: {
        codex: {
          activityStatus: "idle",
          nativeSessionId: "codex-session-1",
        },
      },
      transcriptSessionId: "codex-session-1",
    },
  });

  assert.equal(groundTruth.restoredRunningTurnLooksIdle, true);
  assert.equal(groundTruth.runningTurnLooksIdle, true);
  assert.equal(groundTruth.effectiveLatestTurnState, "completed");
  assert.equal(groundTruth.terminalGroundTruthStatus, "idle_or_input_ready");
  assert.equal(groundTruth.completedTurnLooksSendable, true);
  assert.equal(groundTruth.agentInputReady, true);
  assert.equal(groundTruth.terminalWorkState, "complete");
});

test("idle non-hook runtime does not settle a restored running turn", () => {
  const groundTruth = getThreadTerminalGroundTruth({
    liveTerminal: {
      activityStatus: "idle",
      agentId: "opencode",
      inputReady: false,
      status: "active",
    },
    providerBinding: {
      activityStatus: "idle",
      inputReady: false,
      status: "active",
    },
    targetRole: "opencode",
    thread: {
      activityStatus: "idle",
      latestTurn: {
        startedAt: "2026-05-30T10:00:00.000Z",
        state: "running",
      },
      messageCount: 2,
      messages: [
        { role: "user", text: "audit the project" },
        { role: "assistant", text: "Done." },
      ],
      projectionEvents: [
        { type: "thread.message.user" },
        { type: "thread.message.assistant.complete" },
      ],
    },
  });

  assert.equal(groundTruth.restoredRunningTurnLooksIdle, false);
  assert.equal(groundTruth.runningTurnLooksIdle, false);
  assert.equal(groundTruth.effectiveLatestTurnState, "running");
  assert.equal(groundTruth.terminalGroundTruthStatus, "processing_or_active");
  assert.equal(groundTruth.agentInputReady, false);
});

test("pending session acceptance keeps a running turn active despite lifecycle input-ready", () => {
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
